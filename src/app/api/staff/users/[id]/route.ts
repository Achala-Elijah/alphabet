import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (!profile || !["admin", "sub_admin"].includes(profile.role)) {
      return NextResponse.json({ error: "Only staff can view customer details." }, { status: 403 });
    }

    const [{ data: transactions, error: transactionsError }, { data: bets, error: betsError }] = await Promise.all([
      supabase.from("customer_transactions").select("id,type,amount,status,reference,created_at").eq("account_id", id).order("created_at", { ascending: false }),
      supabase.from("customer_bets").select("id,stake,potential_return,status,selections,placed_at").eq("account_id", id).order("placed_at", { ascending: false })
    ]);
    if (transactionsError) return NextResponse.json({ error: transactionsError.message }, { status: 400 });
    if (betsError) return NextResponse.json({ error: betsError.message }, { status: 400 });

    return NextResponse.json({
      transactions: transactions || [],
      bets: bets || []
    });
  } catch (error) {
    console.error("Customer details request failed:", error);
    return NextResponse.json({ error: "Could not load customer activity." }, { status: 500 });
  }
}
