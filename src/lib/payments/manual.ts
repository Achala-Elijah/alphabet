import { PaymentError, type CreateDepositInput, type CreateDepositResult, type PaymentProvider, type VerifyDepositResult, type WebhookEvent } from "./types";

/**
 * Default provider while no gateway is connected.
 *
 * It completes the deposit immediately ("simulated success"), which runs the
 * exact same path a real gateway will drive later:
 *   create -> mark paid -> credit wallet -> write wallet ledger row.
 * Swap in Paystack with PAYMENT_PROVIDER=paystack once keys are configured.
 */
export const manualProvider: PaymentProvider = {
  name: "manual",

  async createDeposit(input: CreateDepositInput): Promise<CreateDepositResult> {
    return {
      status: "paid",
      checkoutUrl: null,
      payload: { simulated: true, amount: input.amount, currency: input.currency }
    };
  },

  async verifyDeposit(): Promise<VerifyDepositResult> {
    return { status: "paid", payload: { simulated: true } };
  },

  async parseWebhook(): Promise<WebhookEvent> {
    throw new PaymentError("The manual provider does not send webhooks.", 400);
  }
};
