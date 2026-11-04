import { manualProvider } from "./manual";
import { paystackProvider } from "./paystack";
import { PaymentError, type PaymentProvider } from "./types";

/** Registry — add a new gateway by importing it and adding one line here. */
const providers: Record<string, PaymentProvider> = {
  manual: manualProvider,
  paystack: paystackProvider
};

export function getPaymentProvider(): PaymentProvider {
  const name = (process.env.PAYMENT_PROVIDER || "manual").trim().toLowerCase();
  const provider = providers[name];
  if (!provider) {
    throw new PaymentError(`Unknown PAYMENT_PROVIDER "${name}". Available: ${Object.keys(providers).join(", ")}.`, 500);
  }
  return provider;
}

export * from "./types";
