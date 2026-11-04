"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function AuthCallbackPage() {
  const [message, setMessage] = useState("Confirming your email...");

  useEffect(() => {
    let active = true;

    async function completeSignIn() {
      const code = new URLSearchParams(window.location.search).get("code");
      if (!code) {
        if (active) setMessage("This confirmation link is incomplete or expired. Request a new email.");
        return;
      }

      try {
        const supabase = createSupabaseBrowserClient();
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) throw error;
        window.location.replace("/");
      } catch (error) {
        if (active) {
          setMessage(error instanceof Error
            ? `${error.message}. Request a new confirmation email and open it in the same browser.`
            : "This confirmation link could not be completed. Request a new email.");
        }
      }
    }

    void completeSignIn();
    return () => { active = false; };
  }, []);

  return (
    <main className="auth-callback">
      <div className="auth-callback-card">
        <div className="auth-role-icon">✓</div>
        <h1>AlphaBet</h1>
        <p>{message}</p>
        <a href="/login">Return to sign in</a>
      </div>
    </main>
  );
}
