import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCustomerSession } from "@/lib/custom-auth";

export async function GET() {
  const customer = await getCustomerSession();
  if (!customer) return NextResponse.json({ error: "Sign in to view your wallet." }, { status: 401 });
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("customer_transaction_history", { p_account_id: customer.account_id });
  if (error) return NextResponse.json({ error: "Wallet history is temporarily unavailable." }, { status: 500 });
  return NextResponse.json({ balance: customer.balance, transactions: data || [] });
}
