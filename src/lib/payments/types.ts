/**
 * Payment provider contract.
 *
 * Every gateway (manual, Paystack, Flutterwave, ...) implements this interface,
 * so the rest of the app never talks to a specific provider. To add a gateway:
 *   1. create `yourgateway.ts` exporting a PaymentProvider
 *   2. register it in `index.ts`
 *   3. set PAYMENT_PROVIDER=yourgateway in .env
 * See README.md in this folder for the full checklist.
 */

export type PaymentProviderName = "manual" | "paystack" | "alphapay";

export type Currency = "GHS" | "NGN";

export type DepositStatus = "pending" | "paid" | "failed";

/** Who the deposit belongs to. Exactly one side is always set. */
export type DepositSubject =
  | { type: "staff"; staffId: string }
  | { type: "customer"; accountId: string };

export type CreateDepositInput = {
  reference: string;
  amount: number;
  currency: Currency;
  subject: DepositSubject;
  /** Where the provider should send the customer after hosted checkout. */
  callbackUrl?: string;
  customer?: { email?: string | null; phone?: string | null };
};

export type CreateDepositResult = {
  status: DepositStatus;
  /** Hosted payment page (gateway flow). Null when nothing to redirect to. */
  checkoutUrl?: string | null;
  payload?: Record<string, unknown> | null;
};

/** Amounts returned here are in major units (GHS / NGN), never pesewas/kobo. */
export type VerifyDepositResult = {
  status: DepositStatus;
  amount?: number;
  currency?: Currency;
  payload?: Record<string, unknown> | null;
};

export type WebhookEvent = {
  /** Internal DEP-... reference (legacy ACT-... is still accepted), or the
   * gateway reference when the provider cannot map back to ours. */
  reference: string;
  status: DepositStatus;
  amount?: number;
  currency?: Currency;
  payload?: Record<string, unknown> | null;
  /** Gateway name — used for fallback lookups by external reference. */
  provider?: PaymentProviderName;
  /** The gateway's own transaction reference (e.g. AlphaPay TXN-...). */
  externalReference?: string;
};

export interface PaymentProvider {
  readonly name: PaymentProviderName;
  /** Start a deposit. Returns a checkout URL when the provider hosts payment. */
  createDeposit(input: CreateDepositInput): Promise<CreateDepositResult>;
  /**
   * Ask the provider for the authoritative status of a deposit (idempotent).
   * Implementations should compare `expected` against what the provider
   * actually charged and fail the deposit on any mismatch.
   */
  verifyDeposit(
    reference: string,
    expected?: { amount: number; currency: Currency },
    providerPayload?: Record<string, unknown> | null
  ): Promise<VerifyDepositResult>;
  /**
   * Verify authenticity and unpack a provider webhook. Throws when unsupported.
   * `headers` carries raw request headers (x-webhook-signature, x-webhook-timestamp, …)
   * for providers that need them; Paystack uses only the `signature` arg.
   */
  parseWebhook(body: string, signature: string | null, headers?: Record<string, string>): Promise<WebhookEvent>;
}

export class PaymentError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "PaymentError";
    this.status = status;
  }
}
