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
 * NGN never uses a gateway in this deployment. Nigerian customers transfer to
 * OPay and upload payment proof; an admin approves it before the wallet moves.
 * GHS uses whichever gateway `PAYMENT_PROVIDER` selects.
 */
export function gatewaySupportsCurrency(currency: Currency): boolean {
  return currency !== "NGN";
}

export * from "./types";
