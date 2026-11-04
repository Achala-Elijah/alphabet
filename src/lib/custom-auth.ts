import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

const COOKIE = "alphabet_session";
const LEGACY_COOKIE = "betkiing_session";
function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase is not configured.");
  return createClient(url, key);
}
export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export async function createCustomerSession(phone: string, password: string) {
  const token = randomBytes(32).toString("hex");
  const { data, error } = await client().rpc("customer_login", { p_phone: phone, p_password: password, p_token_hash: hashToken(token) });
  if (error) throw new Error(error.message);
  const cookieStore = await cookies();
  cookieStore.set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return data?.[0];
}
export async function getCustomerSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE)?.value || cookieStore.get(LEGACY_COOKIE)?.value;
  if (!token) return null;
  const { data } = await client().rpc("customer_session", { p_token_hash: hashToken(token) });
  return data?.[0] || null;
}
export { COOKIE, LEGACY_COOKIE };
