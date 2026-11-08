/**
 * OPay account details shown to Naira customers paying by manual transfer.
 * Configured via env — never hard-code account numbers in the UI.
 */
export type OpayAccount = {
  bank: string;
  accountNumber: string;
  accountName: string;
};

export function getOpayAccount(): OpayAccount | null {
  const accountNumber = (process.env.NAIRA_OPAY_ACCOUNT_NUMBER || "").trim();
  if (!accountNumber) return null;
  return {
    bank: (process.env.NAIRA_OPAY_BANK || "OPay").trim(),
    accountNumber,
    accountName: (process.env.NAIRA_OPAY_ACCOUNT_NAME || "").trim()
  };
}
