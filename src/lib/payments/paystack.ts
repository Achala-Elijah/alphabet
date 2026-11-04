import { createHmac, timingSafeEqual } from "crypto";
import { PaymentError, type CreateDepositInput, type CreateDepositResult, type Currency, type DepositStatus, type PaymentProvider, type VerifyDepositResult, type WebhookEvent } from "./types";

/**
 * Paystack gateway.
 *
 * Standard hosted-checkout flow:
 *   initialize -> customer pays -> webhook + verify -> credit wallet
 *
 * Set PAYMENT_PROVIDER=paystack in .env. The secret key is required
 * server-side; the public key (PAYSTACK_PUBLIC_KEY) is only needed if you
 * later move to inline JS on the client — hosted checkout does not need it.
 *
 * Test with Paystack test keys (https://paystack.com/test-mode) before
 * switching to live keys. Docs: https://developers.paystack.co/reference
 * API: https://developers.paystack.co/reference/api-transaction
 */

const BASE_URL = "https://api.paystack.co";

function secretKey() {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key?.startsWith("sk_")) {
    throw new PaymentError("Paystack is not configured. Add your PAYSTACK_SECRET_KEY (sk_test_... or sk_live_...) to .env and restart Next.js.", 503);
  }
  return key;
}

/**
 * Optional client-side check only. Hosted checkout never needs the public
 * key — calling this at startup fails fast if someone pasted the wrong key.
 */
export function publicKey() {
  const key = process.env.PAYSTACK_PUBLIC_KEY;
  if (!key) {
    return null;
  }
  if (!key.startsWith("pk_")) {
    throw new PaymentError("PAYSTACK_PUBLIC_KEY must start with pk_ (pk_test_... or pk_live_...).", 503);
  }
  return key;
}

/** Paystack charges in the smallest currency unit: kobo (NGN) and pesewas (GHS). */
function minorUnits(amount: number) {
  return Math.round(amount * 100);
}

/**
 * Paystack channel configuration for deposits.
 *
 * Ghana (GHS): card, mobile_money (MTN, Vodafone, AT), bank_transfer
 * Nigeria (NGN): card, bank_transfer, USSD (via bank_transfer channel)
 *
 * Paystack shows the channels it has enabled on the merchant account.
 * Make sure Settings > Payments in the Paystack Dashboard has
 * Mobile Money and Bank Transfer enabled for your country.
 */
export const PAYSTACK_DEPOSIT_CHANNELS = ["card", "mobile_money", "bank_transfer"] as const;

async function paystackFetch(path: string, init?: RequestInit) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${secretKey()}`, "Content-Type": "application/json", ...init?.headers }
  });
  const data = (await response.json().catch(() => null)) as { status?: boolean; message?: string; data?: Record<string, unknown> } | null;
  if (!response.ok || !data?.status) throw new PaymentError(`Paystack: ${data?.message || response.statusText}`, 502);
  return data.data || {};
}

function mapStatus(status: string): DepositStatus {
  const normalized = status.trim().toLowerCase();
  if (normalized === "success" || normalized === "succeeded" || normalized === "paid" || normalized === "completed") return "paid";
  if (normalized === "failed" || normalized === "failure" || normalized === "abandoned") return "failed";
  return "pending";
}

export const paystackProvider: PaymentProvider = {
  name: "paystack",

  async createDeposit(input: CreateDepositInput): Promise<CreateDepositResult> {
    // Cheap sanity check only — hosted checkout does not use the public key.
    publicKey();
    // Paystack strictly validates the email — it must look like a real
    // address. The fallback below uses a valid domain (not .local) and only
    // falls back when the wallet has no real email on file.
    const MIN_EMAIL = "user@example.com";
    const rawEmail = input.customer?.email ? String(input.customer.email).trim() : "";
    const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(rawEmail);
    const resolvedEmail = isValidEmail ? rawEmail : MIN_EMAIL;
    if (!isValidEmail && rawEmail) {
      // Invalid stored email — fall back instead of failing the deposit.
      console.warn(`Paystack: invalid stored email "${rawEmail.slice(0, 40)}" — using fallback for reference ${input.reference}`);
    }
    const phone = input.customer?.phone;
    const payload: Record<string, unknown> = {
      email: resolvedEmail,
      amount: minorUnits(input.amount),
      currency: input.currency,
      reference: input.reference,
      channels: PAYSTACK_DEPOSIT_CHANNELS
    };

    // A callback URL is the browser return path. /api/payments/deposit sets
    // it to the caller's wallet page (staff -> /sub-admin/wallet,
    // customer -> /account?nav=wallet) so Paystack returns to the right place.
    if (input.callbackUrl) {
      payload.callback_url = input.callbackUrl;
    }

    if (phone || input.subject) {
      const metadata: Record<string, unknown> = {
        subject_type: input.subject.type,
        subject_id: input.subject.type === "staff" ? input.subject.staffId : input.subject.accountId
      };
      if (phone) {
        metadata.phone = phone;
        metadata.custom_fields = [
          { display_name: "Phone Number", variable_name: "phone_number", value: phone }
        ];
      }
      payload.metadata = metadata;
    }

    const data = await paystackFetch("/transaction/initialize", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const checkoutUrl = String((data as { authorization_url?: unknown }).authorization_url || "");
    if (!checkoutUrl) {
      throw new PaymentError("Paystack did not return a checkout URL.", 502);
    }
    return {
      status: "pending",
      checkoutUrl,
      payload: data as Record<string, unknown>
    };
  },

  async verifyDeposit(reference: string, expected?: { amount: number; currency: Currency }): Promise<VerifyDepositResult> {
    if (!reference) {
      throw new PaymentError("A deposit reference is required.", 400);
    }
    const data = await paystackFetch(`/transaction/verify/${encodeURIComponent(reference)}`);
    const payload = data as Record<string, unknown>;
    const status = mapStatus(String(payload.status || ""));
    const amount = typeof payload.amount === "number" ? payload.amount / 100 : undefined;
    const currency = typeof payload.currency === "string" ? (payload.currency.toUpperCase() as Currency) : undefined;
    const mismatched = Boolean(expected && (
      (amount !== undefined && Math.abs(amount - expected.amount) > 0.001) ||
      (currency !== undefined && currency !== expected.currency)
    ));
    return { status: mismatched ? "failed" : status, amount, currency, payload };
  },

  async parseWebhook(body: string, signature: string | null): Promise<WebhookEvent> {
    if (!body) throw new PaymentError("Empty webhook payload.", 400);
    if (!signature) throw new PaymentError("Missing Paystack signature.", 401);
    const expected = createHmac("sha512", secretKey()).update(body).digest();
    const provided = Buffer.from(signature, "hex");
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new PaymentError("Invalid Paystack signature.", 401);
    }
    let event: { event?: string; data?: { reference?: string; status?: string; amount?: number; currency?: string } };
    try {
      event = JSON.parse(body) as { event?: string; data?: { reference?: string; status?: string; amount?: number; currency?: string } };
    } catch {
      throw new PaymentError("Webhook payload is not valid JSON.", 400);
    }
    const reference = event.data?.reference;
    if (!reference) throw new PaymentError("Webhook is missing a transaction reference.", 400);
    // Paystack's Paystack docs list `charge.success` as the useful event, but it
    // also sends transfer and other lifecycle events. We only act on deposits.
    const status: DepositStatus = event.event === "charge.success" ? "paid" : event.event === "charge.failed" ? "failed" : "pending";
    if (status === "pending") throw new PaymentError(`Unhandled Paystack event "${event.event}".`, 400);
    return {
      reference,
      status,
      amount: typeof event.data?.amount === "number" ? event.data.amount / 100 : undefined,
      currency: typeof event.data?.currency === "string" ? (event.data.currency.toUpperCase() as Currency) : undefined,
      payload: (event.data || {}) as Record<string, unknown>
    };
  }
};

export type TransferRecipientInput = {
  type: "mobile_money" | "nuban";
  name: string;
  accountNumber: string;
  bankCode: string; // "MTN", "VOD", "ATL", etc.
  currency: Currency;
};

export type InitiateTransferInput = {
  amount: number;
  recipientCode: string;
  reason?: string;
  reference?: string;
};

/**
 * Create a Paystack transfer recipient for Mobile Money or Bank transfers.
 */
export async function createTransferRecipient(input: TransferRecipientInput): Promise<{ recipientCode: string }> {
  const data = await paystackFetch("/transferrecipient", {
    method: "POST",
    body: JSON.stringify({
      type: input.type,
      name: input.name,
      account_number: input.accountNumber,
      bank_code: input.bankCode,
      currency: input.currency
    })
  });
  const res = data as { recipient_code?: string };
  if (!res.recipient_code) throw new PaymentError("Paystack could not create a transfer recipient.", 502);
  return { recipientCode: res.recipient_code };
}

/**
 * Initiate an automated payout/transfer from your Paystack balance to Mobile Money.
 */
export async function initiateTransfer(input: InitiateTransferInput): Promise<{ transferCode: string; status: string }> {
  const data = await paystackFetch("/transfer", {
    method: "POST",
    body: JSON.stringify({
      source: "balance",
      amount: minorUnits(input.amount),
      recipient: input.recipientCode,
      reason: input.reason || "AlphaBet withdrawal",
      reference: input.reference
    })
  });
  const res = data as { transfer_code?: string; status?: string };
  return { transferCode: String(res.transfer_code || ""), status: String(res.status || "pending") };
}
