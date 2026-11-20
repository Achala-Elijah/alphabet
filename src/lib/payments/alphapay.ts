import { createHmac, timingSafeEqual } from "crypto";
import { PaymentError, type Currency, type DepositStatus, type PaymentProvider, type CreateDepositInput, type CreateDepositResult, type VerifyDepositResult, type WebhookEvent } from "./types";

/**
 * AlphaPay gateway provider.
 *
 * Docs: https://docs.alphapay.me
 *
 * Hosted checkout flow:
 *   1. POST /checkout-sessions/            -> { id, slug, checkout_url }
 *   2. Customer pays on the AlphaPay page
 *   3. Browser redirects to return_url (we append ?reference=DEP-...)
 *   4. /account?nav=wallet or /sub-admin/wallet calls verifyAndSettle()
 *   5. Webhook (transaction.success) is the server-to-server backup
 *
 * Important API details (from the docs):
 *   - amount is a DECIMAL STRING in major units, e.g. "5000.00"
 *   - customer_email and customer_name are REQUIRED
 *   - metadata is supported on checkout sessions
 *   - webhook signature: HMAC-SHA256(webhookSecret, `${timestamp}.${rawBody}`)
 *   - webhook events: transaction.success / transaction.failed / transaction.cancelled
 *   - webhook data.reference is AlphaPay's TXN-... reference, NOT our DEP-...
 *     reference, so we embed ours in metadata + description and recover it.
 */

const API_BASE_LIVE = "https://api.alphapay.me/api/v1";
const API_BASE_SANDBOX = "https://sandbox-api.alphapay.me/api/v1";

type ApiError = { message?: string | string[]; detail?: string; code?: string };

function apiKey(): string {
  const key = process.env.ALPHAPAY_SECRET_KEY?.trim();
  if (!key) {
    throw new PaymentError("AlphaPay secret key not configured. Add ALPHAPAY_SECRET_KEY to .env and restart Next.js.", 503);
  }
  return key;
}

function apiBase(key: string): string {
  if (process.env.ALPHAPAY_SANDBOX === "true") return API_BASE_SANDBOX;
  // Test keys always use the sandbox; live keys use production.
  return key.startsWith("sk_test_") ? API_BASE_SANDBOX : API_BASE_LIVE;
}

function authHeaders(key: string): HeadersInit {
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Every AlphaPay response uses `{ success, data, code }`. */
function unwrap(payload: Record<string, unknown>): Record<string, unknown> {
  const nested = payload.data;
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? { ...payload, ...(nested as Record<string, unknown>) }
    : payload;
}

function messageOf(payload: Record<string, unknown>, fallback: string): string {
  const data = unwrap(payload);
  const message = data.message ?? payload.message;
  if (Array.isArray(message)) return message.join(", ");
  if (typeof message === "string" && message) return message;

  const error = payload.error ?? data.error;
  if (error && typeof error === "object") {
    const fields = error as Record<string, unknown>;
    if (typeof fields.message === "string" && fields.message) return fields.message;
    const parts = Object.entries(fields).map(([key, value]) =>
      `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`
    );
    if (parts.length) return parts.join("; ");
  }
  if (typeof data.detail === "string" && data.detail) return data.detail;
  return fallback;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/** Find our internal DEP-/ACT- reference anywhere inside an AlphaPay payload. */
function findInternalReference(value: unknown, depth = 0): string | undefined {
  if (depth > 5 || value === null || value === undefined) return undefined;
  if (typeof value === "string") {
    const match = value.match(/\b(?:DEP|ACT)-[A-Z0-9]+\b/);
    return match ? match[0] : undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findInternalReference(item, depth + 1);
      if (found) return found;
    }
  } else if (typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      const found = findInternalReference(item, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

/** Checkout session body — see /api-reference/payments/checkout-create. */
function createSessionBody(input: CreateDepositInput & { reference: string; callbackUrl: string }): Record<string, unknown> {
  const { amount, currency, customer, reference, subject } = input;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new PaymentError("Enter a valid amount greater than zero.", 400);
  }

  let returnUrl: string;
  try {
    const url = new URL(input.callbackUrl);
    url.searchParams.set("reference", reference);
    returnUrl = url.toString();
  } catch {
    returnUrl = input.callbackUrl;
  }

  // customer_email and customer_name are required by AlphaPay. Fall back to a
  // deterministic address when a customer record has no email on file.
  const email = customer?.email?.trim() || `${reference.toLowerCase()}@alphabet.app`;
  const name = email.split("@")[0] || "AlphaBet Customer";

  return {
    amount: amount.toFixed(2), // decimal string in major units, e.g. "50.00"
    currency,
    country: currency === "NGN" ? "NG" : "GH",
    description: `AlphaBet deposit ${reference}`,
    customer_email: email,
    customer_name: name,
    customer_phone: customer?.phone?.trim() || "",
    return_url: returnUrl,
    // Echoed on the session; lets a webhook map TXN-... back to our deposit.
    metadata: {
      deposit_reference: reference,
      subject_type: subject.type
    }
  };
}

function mapStatus(raw: string): DepositStatus {
  const upper = raw.trim().toUpperCase();
  if (upper === "SUCCESS" || upper === "PAID" || upper === "COMPLETED") return "paid";
  if (upper === "FAILED" || upper === "EXPIRED" || upper === "CANCELLED") return "failed";
  return "pending";
}

export const alphapayProvider: PaymentProvider = {
  name: "alphapay",

  async createDeposit(input: CreateDepositInput): Promise<CreateDepositResult> {
    const key = apiKey();
    const payload = createSessionBody({
      ...input,
      reference: input.reference,
      callbackUrl: input.callbackUrl || "/"
    });

    const response = await fetch(`${apiBase(key)}/checkout-sessions/`, {
      method: "POST",
      headers: authHeaders(key),
      body: JSON.stringify(payload)
    });
    const rawBody = await response.text();
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      // Non-JSON response (proxy/HTML error page) — handled below.
    }
    if (!response.ok) {
      throw new PaymentError(`AlphaPay: ${messageOf(data, response.statusText)}`, response.status);
    }

    const session = unwrap(data);

    const sessionId = asString(session.id)
      || asString(session.session_id)
      || asString(session.sessionId)
      || asString(session.checkout_session_id)
      || asString(session.payment_id);
    const checkoutUrl = asString(session.checkout_url)
      || asString(session.checkoutUrl)
      || asString(session.url)
      || asString(session.payment_url);

    if (!sessionId || !checkoutUrl) {
      // Log the raw response so the unexpected shape can be diagnosed.
      console.error("AlphaPay create-session response:", JSON.stringify({
        status: response.status,
        contentType: response.headers.get("content-type"),
        keys: Object.keys(session),
        body: rawBody.slice(0, 1500)
      }));
      const detail = process.env.NODE_ENV !== "production" ? ` Response: ${rawBody.slice(0, 400)}` : "";
      throw new PaymentError(`AlphaPay did not return a usable checkout session.${detail}`, 502);
    }

    return {
      status: "pending",
      checkoutUrl,
      payload: {
        sessionId,
        slug: asString(session.slug),
        alphaPayAmount: asString(session.amount),
        alphaPayCurrency: asString(session.currency),
        alphaPayStatus: asString(session.status),
        depositReference: input.reference
      }
    };
  },

  /**
   * Query the checkout session by its ID. The /payments/{payment_id}/verify/
   * endpoint expects a transaction UUID, not a session ID, so the session
   * detail endpoint is the correct source for redirect-based confirmation.
   */
  async verifyDeposit(reference, expected, providerPayload): Promise<VerifyDepositResult> {
    const key = apiKey();
    const sessionId = asString(providerPayload?.sessionId);
    if (!sessionId) {
      throw new PaymentError("AlphaPay verify: missing session ID in provider_payload.", 502);
    }

    const response = await fetch(`${apiBase(key)}/checkout-sessions/${encodeURIComponent(sessionId)}/`, {
      headers: authHeaders(key)
    });
    const data = unwrap(await readJson(response));
    if (!response.ok) {
      throw new PaymentError(`AlphaPay verify failed: ${messageOf(data as ApiError & Record<string, unknown>, response.statusText)}`, response.status);
    }

    const transaction = data.transaction && typeof data.transaction === "object"
      ? (data.transaction as Record<string, unknown>)
      : null;
    const amountRaw = asString(transaction?.amount) || asString(data.amount);
    const amount = amountRaw ? Number(amountRaw.replace(/[^0-9.-]/g, "")) : undefined;
    const currency = (asString(transaction?.currency) || asString(data.currency)) as Currency | undefined;

    return {
      status: mapStatus(asString(data.status) || "PENDING"),
      amount: Number.isFinite(amount) ? amount : undefined,
      currency,
      payload: {
        alphaPaySession: sessionId,
        alphaPayReference: asString(transaction?.reference),
        alphaPayTransactionId: asString(transaction?.id),
        depositReference: reference
      }
    };
  },

  /**
   * Verify a webhook and map it to a local deposit.
   *
   * Preferred: HMAC signature with ALPHAPAY_WEBHOOK_SECRET (dashboard ->
   * Webhooks -> signing secret). If that secret was not copied, we never trust
   * the raw webhook body — instead we re-fetch the transaction from AlphaPay
   * with the API key and use AlphaPay's own response as the source of truth.
   */
  async parseWebhook(body, signature, headers): Promise<WebhookEvent> {
    let event: { event?: string; data?: Record<string, unknown> };
    try {
      event = JSON.parse(body) as { event?: string; data?: Record<string, unknown> };
    } catch {
      throw new PaymentError("AlphaPay webhook: invalid JSON payload.", 400);
    }
    const eventData = event.data && typeof event.data === "object" ? event.data : {};
    const eventName = event.event || "";
    const secret = process.env.ALPHAPAY_WEBHOOK_SECRET?.trim();

    let data: Record<string, unknown> = eventData;
    let status: DepositStatus = "pending";

    if (secret) {
      const rawSignature = headers?.["x-webhook-signature"] || (signature?.includes("|") ? signature.split("|")[0] : signature);
      const rawTimestamp = headers?.["x-webhook-timestamp"] || (signature?.includes("|") ? signature.split("|")[1] : undefined);
      if (!rawSignature || !rawTimestamp) {
        throw new PaymentError("AlphaPay webhook: missing signature or timestamp header.", 400);
      }
      const timestamp = Number(rawTimestamp);
      if (!Number.isFinite(timestamp) || Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) {
        throw new PaymentError("AlphaPay webhook: timestamp outside the 5 minute tolerance.", 400);
      }

      const expected = createHmac("sha256", secret).update(`${rawTimestamp}.${body}`).digest("hex");
      const a = Buffer.from(rawSignature);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw new PaymentError("AlphaPay webhook: invalid signature.", 400);
      }

      if (eventName === "transaction.success" || eventName === "payment.succeeded") status = "paid";
      else if (eventName === "transaction.failed" || eventName === "transaction.cancelled" || eventName === "payment.failed") status = "failed";
    } else {
      // No signing secret available: ask AlphaPay itself whether the
      // transaction actually succeeded. A forged webhook cannot credit a
      // wallet because the status comes from AlphaPay, not from the body.
      const transactionId = asString(eventData.id);
      if (!transactionId) {
        throw new PaymentError("AlphaPay webhook: signing secret not configured and no transaction ID to re-check.", 401);
      }
      try {
        const key = apiKey();
        const txnResponse = await fetch(`${apiBase(key)}/transactions/${encodeURIComponent(transactionId)}/`, {
          headers: authHeaders(key)
        });
        if (!txnResponse.ok) {
          throw new PaymentError("AlphaPay webhook: transaction re-check failed.", 401);
        }
        data = unwrap(await readJson(txnResponse));
        status = mapStatus(asString(data.status) || "PENDING");
      } catch (reason) {
        if (reason instanceof PaymentError) throw reason;
        throw new PaymentError("AlphaPay webhook: could not re-check the transaction with AlphaPay.", 401);
      }
    }

    // Recover our internal reference from metadata/description (webhooks may
    // echo it) or, if needed, from the authoritative transaction detail.
    let reference = findInternalReference(data) || findInternalReference(eventData);
    if (!reference) {
      const transactionId = asString(eventData.id);
      if (transactionId && data === eventData) {
        try {
          const key = apiKey();
          const txnResponse = await fetch(`${apiBase(key)}/transactions/${encodeURIComponent(transactionId)}/`, {
            headers: authHeaders(key)
          });
          if (txnResponse.ok) reference = findInternalReference(unwrap(await readJson(txnResponse)));
        } catch {
          // The redirect-based verify path remains the fallback.
        }
      }
    }

    const amountRaw = asString(data.amount) || asString(data.requested_amount);
    const amount = amountRaw ? Number(amountRaw.replace(/[^0-9.-]/g, "")) : undefined;
    const currency = (asString(data.currency) || asString(eventData.currency)) as Currency | undefined;
    const alphaPayReference = asString(data.reference) || asString(eventData.reference);

    return {
      reference: reference || alphaPayReference || "",
      status,
      amount: Number.isFinite(amount) ? amount : undefined,
      currency,
      provider: "alphapay",
      externalReference: alphaPayReference,
      payload: data
    };
  }
};
