export type CustomerCurrency = "GHS" | "NGN";

export function currencySymbol(currency?: string | null) {
  return currency === "NGN" ? "₦" : "GH₵";
}

export function formatCustomerAmount(amount: number | string | null | undefined, currency?: string | null) {
  return `${currencySymbol(currency)} ${Number(amount || 0).toFixed(2)}`;
}
