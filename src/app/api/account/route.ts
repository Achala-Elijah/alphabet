import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCustomerSession } from "@/lib/custom-auth";

export async function PATCH(request: Request) {
  const customer = await getCustomerSession();
  if (!customer) return NextResponse.json({ error: "Sign in to update your account." }, { status: 401 });
  const body = await request.json() as { currency?: string; email?: string | null };
  const currency = body.currency === "NGN" ? "NGN" : body.currency === "GHS" ? "GHS" : "";
  const email = body.email?.trim() || null;
  if (!currency) return NextResponse.json({ error: "Choose a supported currency." }, { status: 400 });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("customer_update_profile", { p_account_id: customer.account_id, p_currency: currency, p_email: email });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, currency, email });
}
