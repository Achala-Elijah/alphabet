import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.json({ ok: false, supabaseConfigured: false, databaseReady: false }, { status: 503 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("matches").select("id").limit(1);
    if (error) {
      const missingSchema = error.message.includes("Could not find the table") || error.code === "42P01";
      return NextResponse.json({
        ok: false,
        supabaseConfigured: true,
        databaseReady: false,
        error: missingSchema ? "Run supabase/schema.sql in the Supabase SQL Editor." : "Supabase database check failed."
      }, { status: 503 });
    }
    return NextResponse.json({ ok: true, supabaseConfigured: true, databaseReady: true });
  } catch {
    return NextResponse.json({ ok: false, supabaseConfigured: true, databaseReady: false, error: "Supabase is unreachable." }, { status: 503 });
  }
}
