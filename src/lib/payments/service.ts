import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";
import { getPaymentProvider } from "./index";
import { PaymentError, type Currency, type DepositStatus, type DepositSubject, type WebhookEvent } from "./types";

/**
 * Payment orchestration — provider agnostic.
 *
 * Every deposit follows the same lifecycle regardless of gateway:
 *   create (record intent) -> provider confirms (checkout/webhook/verify)
 *   -> settle (claim status, credit wallet, write wallet ledger)
 */

type DepositRow = {
  id: string;
  reference: string;
  provider: string;
  status: DepositStatus;
  amount: number;
  currency: Currency;
  staff_id: string | null;
  account_id: string | null;
  checkout_url: string | null;
  paid_at: string | null;
  created_at: string;
};

let client: SupabaseClient | undefined;

/**
 * Server-side writer/reader. Deposits are only mutated with the service key.
 * Validates the payment environment once so missing config fails fast with
 * an actionable message instead of a deep failure during a checkout.
 */
export function paymentsClient(): SupabaseClient {
  if (client === undefined) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const urlOk = Boolean(url && /^https?:\/\/.+\.supabase\.co$/.test(url.trim()));
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!urlOk) {
      throw new PaymentError("NEXT_PUBLIC_SUPABASE_URL is missing or invalid. Check .env and restart Next.js.", 503);
    }
    if (!serviceKey) {
      throw new PaymentError("SUPABASE_SERVICE_ROLE_KEY is missing. Add it to .env and restart Next.js.", 503);
    }
    client = createClient(url!, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  }
  return client;
}

function newReference() {
  return `DEP-${Date.now().toString(36).toUpperCase()}${randomBytes(4).toString("hex").toUpperCase()}`;
}

function tableHint(error: { message: string }) {
  return error.message.includes("deposits")
    ? "Deposit records are missing. Run supabase/payments-migration.sql in the Supabase SQL Editor, then try again."
    : error.message;
}

async function readDeposit(db: SupabaseClient, reference: string): Promise<DepositRow | null> {
  const { data, error } = await db.from("deposits").select("*").eq("reference", reference).maybeSingle();
  if (error) throw new PaymentError(tableHint(error), 500);
  return (data as DepositRow | null) || null;
}

async function getBalance(db: SupabaseClient, row: DepositRow): Promise<number> {
  const { data, error } = row.staff_id
    ? await db.from("profiles").select("balance").eq("id", row.staff_id).single()
    : await db.from("customer_accounts").select("balance").eq("id", row.account_id || "").single();
  if (error || !data) throw new PaymentError(`Could not read the wallet: ${error?.message || "wallet not found"}`, 500);
  return Number((data as { balance: number }).balance || 0);
}

async function creditBalance(db: SupabaseClient, row: DepositRow): Promise<number> {
  const amount = Number(row.amount);
  const now = new Date().toISOString();
  if (row.staff_id) {
    const balance = Math.round((await getBalance(db, row) + amount) * 100) / 100;
    const { error } = await db.from("profiles").update({ balance, updated_at: now }).eq("id", row.staff_id);
    if (error) throw new PaymentError(`Could not credit the wallet: ${error.message}`, 500);
    return balance;
  }
  if (row.account_id) {
    const balance = Math.round((await getBalance(db, row) + amount) * 100) / 100;
    const { error } = await db.from("customer_accounts").update({ balance, updated_at: now }).eq("id", row.account_id);
    if (error) throw new PaymentError(`Could not credit the wallet: ${error.message}`, 500);
    return balance;
  }
  throw new PaymentError("This deposit has no wallet to credit.", 500);
}

/** Wallet history rows so existing wallet screens keep showing deposits. */
async function writeLedger(db: SupabaseClient, row: DepositRow) {
  const entry = { amount: Number(row.amount), status: "completed", reference: row.reference, type: "deposit" };
  const { error } = row.staff_id
    ? await db.from("transactions").insert({ ...entry, user_id: row.staff_id })
    : await db.from("customer_transactions").insert({ ...entry, account_id: row.account_id });
  if (error) throw new PaymentError(`Could not write the wallet history: ${error.message}`, 500);
}

/** Undo a ledger row when the balance credit did not go through. */
async function removeLedger(db: SupabaseClient, row: DepositRow) {
  if (row.staff_id) {
    await db.from("transactions").delete().eq("reference", row.reference).eq("user_id", row.staff_id);
  } else if (row.account_id) {
    await db.from("customer_transactions").delete().eq("reference", row.reference).eq("account_id", row.account_id);
  }
}

export async function markDepositFailed(db: SupabaseClient, reference: string) {
  await db.from("deposits").update({ status: "failed", updated_at: new Date().toISOString() }).eq("reference", reference).eq("status", "pending");
}

/**
 * Credit the wallet for a paid deposit. Idempotent: the status claim below
 * guarantees a deposit is only ever settled once, even if a webhook and a
 * verify call race each other.
 */
export async function settleDeposit(db: SupabaseClient, reference: string): Promise<{ status: DepositStatus; balance: number }> {
  const row = await readDeposit(db, reference);
  if (!row) throw new PaymentError("Deposit not found.", 404);
  if (row.status !== "pending") return { status: row.status, balance: await getBalance(db, row) };

  const now = new Date().toISOString();
  const { data: claimed } = await db.from("deposits")
    .update({ status: "paid", paid_at: now, updated_at: now })
    .eq("reference", reference)
    .eq("status", "pending")
    .select("id");
  if (!claimed?.length) {
    const current = await readDeposit(db, reference);
    return { status: current?.status || row.status, balance: await getBalance(db, row) };
  }

  try {
    // History first: if the ledger write fails nothing has been credited yet,
    // and if the credit fails the history row is removed again — so the reset
    // to "pending" below can never leave a balance credited twice on retry.
    await writeLedger(db, row);
    const balance = await creditBalance(db, row);

    // Hidden sub-admin commission: 65% of this deposit is added to the
    // referring sub-admin's wallet. The user keeps 100% — this is additive.
    // Failures here never fail the deposit itself.
    if (row.account_id) {
      try {
        const { handleDepositCommission } = await import("@/lib/commissions/service");
        await handleDepositCommission({
          accountId: row.account_id,
          depositAmount: Number(row.amount),
          currency: row.currency,
          depositReference: reference
        });
      } catch (err) {
        console.error(`Commission hook failed for deposit ${reference} (non-fatal):`, err instanceof Error ? err.message : err);
      }
    }

    return { status: "paid", balance };
  } catch (reason) {
    await removeLedger(db, row);
    await db.from("deposits").update({ status: "pending", paid_at: null, updated_at: new Date().toISOString() }).eq("reference", reference);
    throw reason;
  }
}

function mismatched(row: DepositRow, reported?: { amount?: number; currency?: Currency }) {
  return Boolean(
    (reported?.amount !== undefined && Math.abs(reported.amount - Number(row.amount)) > 0.001) ||
    (reported?.currency !== undefined && reported.currency !== row.currency)
  );
}

export type CreateDepositArgs = {
  subject: DepositSubject;
  amount: number;
  currency: Currency;
  callbackUrl?: string;
  customer?: { email?: string | null; phone?: string | null };
};

/**
 * Record the intent with the active provider and settle it when already paid.
 *
 * Order matters for live gateways: the provider is initialized FIRST, then
 * the deposit row is inserted. If the row insert fails after Paystack has a
 * transaction, we have no orphan row to credit — the webhook for that
 * reference will simply tell us "Unknown deposit reference" and no wallet
 * is ever credited without a matching local row.
 */
export async function createDeposit(args: CreateDepositArgs) {
  if (!Number.isFinite(args.amount) || args.amount <= 0) {
    throw new PaymentError("Enter a valid amount greater than zero.", 400);
  }
  if (args.amount > 1_000_000) {
    throw new PaymentError("Enter a valid amount up to 1,000,000.", 400);
  }

  const db = paymentsClient();
  const provider = getPaymentProvider();
  const reference = newReference();

  let result;
  try {
    result = await provider.createDeposit({
      reference,
      amount: args.amount,
      currency: args.currency,
      subject: args.subject,
      callbackUrl: args.callbackUrl,
      customer: args.customer
    });
  } catch (reason) {
    if (reason instanceof PaymentError) throw reason;
    throw new PaymentError("The payment gateway could not start the deposit. Try again.", 502);
  }

  const { data, error } = await db.from("deposits").insert({
    reference,
    provider: provider.name,
    // Always start pending; settleDeposit() is what claims and credits.
    status: result.status === "failed" ? "failed" : "pending",
    amount: args.amount,
    currency: args.currency,
    staff_id: args.subject.type === "staff" ? args.subject.staffId : null,
    account_id: args.subject.type === "customer" ? args.subject.accountId : null,
    checkout_url: result.checkoutUrl || null,
    provider_payload: result.payload || null,
    paid_at: null
  }).select("*").single();
  if (error) throw new PaymentError(tableHint(error), 500);

  if (!data) {
    throw new PaymentError("Could not record the deposit.", 500);
  }

  if (result.status === "paid") {
    const settled = await settleDeposit(db, reference);
    return { reference, status: settled.status, checkoutUrl: result.checkoutUrl || null, balance: settled.balance };
  }
  return { reference, status: result.status, checkoutUrl: result.checkoutUrl || null, balance: await getBalance(db, data as DepositRow) };
}

/** Load a deposit only if it belongs to the caller (never leak other wallets). */
export async function getOwnedDeposit(db: SupabaseClient, reference: string, subject: DepositSubject): Promise<DepositRow> {
  const row = await readDeposit(db, reference);
  const owned = row && (subject.type === "staff" ? row.staff_id === subject.staffId : row.account_id === subject.accountId);
  if (!row || !owned) throw new PaymentError("Deposit not found.", 404);
  return row;
}

/**
 * Confirm a pending deposit with the provider, then settle it when paid.
 * Idempotent — safe to call on every wallet-page load or after a redirect.
 */
export async function verifyAndSettle(db: SupabaseClient, reference: string, subject: DepositSubject): Promise<{ status: DepositStatus; balance: number }> {
  if (!reference) {
    throw new PaymentError("A deposit reference is required.", 400);
  }
  const row = await getOwnedDeposit(db, reference, subject);
  if (row.status !== "pending") {
    return { status: row.status, balance: await getBalance(db, row) };
  }

  const provider = getPaymentProvider();
  let result;
  try {
    result = await provider.verifyDeposit(reference, { amount: Number(row.amount), currency: row.currency });
  } catch (reason) {
    // A Paystack 404 means we don't know this reference — treat as failed
    // locally only when the provider explicitly says it's abandoned/failed.
    if (reason instanceof PaymentError) {
      await markDepositFailed(db, reference);
      return { status: "failed", balance: await getBalance(db, row) };
    }
    throw reason;
  }
  if (mismatched(row, result)) {
    await markDepositFailed(db, reference);
    return { status: "failed", balance: await getBalance(db, row) };
  }
  if (result.status === "paid") return settleDeposit(db, reference);
  if (result.status === "failed") {
    await markDepositFailed(db, reference);
    return { status: "failed", balance: await getBalance(db, row) };
  }
  return { status: "pending", balance: await getBalance(db, row) };
}

/**
 * Apply an authenticated provider webhook to a deposit.
 *
 * Webhooks are server-to-server and unauthenticated by session, so we look
 * the deposit up by reference only. The provider has already verified the
 * signature and the amount/currency mismatch check runs before any credit.
 * A deposit already settled is returned as-is (idempotent).
 */
export async function settleFromWebhook(db: SupabaseClient, event: WebhookEvent): Promise<{ status: DepositStatus; balance: number }> {
  if (!event.reference) {
    throw new PaymentError("Webhook is missing a deposit reference.", 400);
  }
  const row = await readDeposit(db, event.reference);
  if (!row) {
    throw new PaymentError("Unknown deposit reference.", 404);
  }
  if (row.status !== "pending") {
    return { status: row.status, balance: await getBalance(db, row) };
  }
  if (mismatched(row, event)) {
    await markDepositFailed(db, event.reference);
    return { status: "failed", balance: await getBalance(db, row) };
  }
  if (event.status === "paid") return settleDeposit(db, event.reference);
  if (event.status === "failed") {
    await markDepositFailed(db, event.reference);
    return { status: "failed", balance: await getBalance(db, row) };
  }
  return { status: row.status, balance: await getBalance(db, row) };
}
