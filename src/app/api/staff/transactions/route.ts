import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!profile || !["admin", "sub_admin"].includes(profile.role)) return NextResponse.json({ error: "Only staff can view transactions." }, { status: 403 });
  let accountsQuery = supabase.from("customer_accounts").select("id,username");
  if (profile.role === "sub_admin") accountsQuery = accountsQuery.eq("referred_by", user.id);
  const { data: accountRows } = await accountsQuery;
  const accountIds = (accountRows || []).map((account) => account.id);
  const transactionQuery = accountIds.length
    ? supabase.from("customer_transactions").select("id,account_id,type,amount,status,reference,created_at").in("account_id", accountIds).order("created_at", { ascending: false })
    : supabase.from("customer_transactions").select("id,account_id,type,amount,status,reference,created_at").eq("id", "00000000-0000-0000-0000-000000000000");
  const accountLookupQuery = supabase.from("customer_accounts").select("id,username").in("id", accountIds.length ? accountIds : ["00000000-0000-0000-0000-000000000000"]);
  const [{ data: transactions, error }, { data: accounts }] = await Promise.all([transactionQuery, accountLookupQuery]);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ transactions: transactions || [], accounts: Object.fromEntries((accounts || []).map((account) => [account.id, account.username])) });
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { id?: string; status?: string };
    if (!body.id || body.status !== "failed") {
      return NextResponse.json({ error: "A transaction id and failed status are required." }, { status: 400 });
    }
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (profile?.role !== "admin") return NextResponse.json({ error: "Only an admin can flag transactions as failed." }, { status: 403 });
    const { error } = await supabase.from("customer_transactions").update({ status: "failed" }).eq("id", body.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Transaction status update failed:", error);
    return NextResponse.json({ error: "Could not update transaction status." }, { status: 500 });
  }
}
