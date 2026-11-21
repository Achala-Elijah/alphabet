import { manualProvider } from "./manual";
import { paystackProvider } from "./paystack";
import { alphapayProvider } from "./alphapay";
import { PaymentError, type Currency, type PaymentProvider } from "./types";

/** Registry — add a new gateway by importing it and adding one line here. */
const providers: Record<string, PaymentProvider> = {
  manual: manualProvider,
  paystack: paystackProvider,
  alphapay: alphapayProvider
};

export function activeProviderName(): string {
  return (process.env.PAYMENT_PROVIDER || "manual").trim().toLowerCase();
}

export function getPaymentProvider(): PaymentProvider {
  const name = activeProviderName();
  const provider = providers[name];
  if (!provider) {
    throw new PaymentError(`Unknown PAYMENT_PROVIDER "${name}". Available: ${Object.keys(providers).join(", ")}.`, 500);
  }
  return provider;
}

/**
 * How a Nigerian (NGN) wallet pays.
 *
 * AlphaPay preselects NG on its hosted checkout and offers MTN/Airtel mobile
 * money, so NGN can use the normal gateway there. Paystack is GHS-only in this
 * deployment, so NGN falls back to the existing OPay screenshot upload.
 */
export function nairaDepositMode(): "alphapay" | "upload" {
  return activeProviderName() === "alphapay" ? "alphapay" : "upload";
}

/** Server-side guard for the gateway deposit routes. */
export function gatewaySupportsCurrency(currency: Currency): boolean {
  return currency !== "NGN" || nairaDepositMode() === "alphapay";
}

export * from "./types";
