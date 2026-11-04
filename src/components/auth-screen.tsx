"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, Eye, EyeOff, ShieldCheck, Sparkles } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type AuthRole = "user" | "admin" | "sub-admin";

const roleCopy: Record<AuthRole, { title: string; subtitle: string; accent: string; destination: string }> = {
  user: { title: "Welcome back", subtitle: "Sign in to manage your bets, wallet, and winnings.", accent: "Play smarter. Bet better.", destination: "/" },
  admin: { title: "Admin sign in", subtitle: "Access platform controls and operational reporting.", accent: "Platform operations", destination: "/sub-admin" },
  "sub-admin": { title: "Sub-admin sign in", subtitle: "Manage fixtures, users, partners, and transactions.", accent: "Workspace access", destination: "/sub-admin" }
};

function phoneIdentity(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return `customer-${digits}@auth.betkiing.local`;
}

export default function AuthScreen({ role, signup = false }: { role: AuthRole; signup?: boolean }) {
  const copy = roleCopy[role];
  const isCustomer = role === "user";
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const error = new URLSearchParams(window.location.search).get("error");
    if (error) setNotice(error === "confirmation_missing" ? "The confirmation link is incomplete or expired." : error);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    const phone = String(form.get("phone") || "").trim();
    const authIdentity = phoneIdentity(phone);
    if (password.length < 6) {
      setNotice("Use a password with at least 6 characters.");
      return;
    }
    setSubmitting(true);
    setNotice("");
    try {
      if (isCustomer) {
        const referralCode = signup ? new URLSearchParams(window.location.search).get("ref") : null;
        const response = await fetch("/api/auth/customer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: signup ? "register" : "login", username: form.get("username"), phone, password, referralCode }) });
        const result = await response.json() as { error?: string };
        if (!response.ok) throw new Error(result.error || "Authentication failed.");
        window.location.assign("/");
        return;
      }
      const supabase = createSupabaseBrowserClient();
      if (signup) {
        const { data, error } = await supabase.auth.signUp({
          email: authIdentity,
          password,
          options: { data: { username: String(form.get("username")), phone } }
        });
        if (error) throw error;
        if (data.session) {
          window.location.assign("/");
          return;
        }
        setNotice("Account created, but Supabase is still requiring confirmation. Disable Confirm email in Supabase Authentication settings, then register again.");
        return;
      }

      const { data, error } = await supabase.auth.signInWithPassword({ email: authIdentity, password });
      if (error) throw error;
      if (!data.user) throw new Error("Supabase did not return a signed-in user.");
      const { data: profile, error: profileError } = await supabase.from("profiles").select("role").eq("id", data.user.id).single();
      if (profileError) throw profileError;
      const expectedRole = role === "sub-admin" ? "sub_admin" : role;
      if (profile.role !== expectedRole) {
        await supabase.auth.signOut();
        throw new Error(`This account is not authorized for ${isCustomer ? "customer" : role} sign in.`);
      }
      window.location.assign(copy.destination);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Authentication failed. Please try again.";
      setNotice(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className={`auth-page auth-${role}`}>
      <section className="auth-promo">
        <Link href="/" className="auth-logo">Alpha<span>Bet</span></Link>
        <div className="auth-promo-copy"><span className="auth-eyebrow"><Sparkles size={14} /> {copy.accent}</span><h1>Every match.<br /><strong>Your moment.</strong></h1><p>Follow the action live, find your markets, and keep every selection in one place.</p></div>
        <div className="auth-promo-footer">18+ &nbsp;•&nbsp; Play responsibly</div>
      </section>
      <section className="auth-panel">
        <Link href="/" className="auth-back"><ArrowLeft size={16} /> Back to AlphaBet</Link>
        <div className="auth-card">
          <div className="auth-card-heading"><div className="auth-role-icon"><ShieldCheck size={19} /></div><h2>{signup ? "Create your account" : copy.title}</h2><p>{signup ? "Join free with your phone number." : copy.subtitle}</p></div>
          <form onSubmit={submit} className="auth-form">
            {signup && <label>Username<input name="username" required placeholder="Choose a username" autoComplete="username" /></label>}
            <label>Phone number<input name="phone" type="tel" required placeholder="+233 20 000 0000" autoComplete="tel" /></label>
            <label>Password<div className="password-field"><input name="password" type={showPassword ? "text" : "password"} required placeholder="Enter your password" autoComplete={signup ? "new-password" : "current-password"} /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label="Toggle password visibility">{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
            {signup && <label className="auth-checkbox"><input type="checkbox" required /> <span>I agree to the Terms & Conditions and confirm I am 18 or older.</span></label>}
            {notice && <p className="auth-error">{notice}</p>}
            <button className="auth-submit" type="submit" disabled={submitting}>{submitting ? "Please wait..." : signup ? "Create account" : "Sign in"} {!submitting && <span>→</span>}</button>
          </form>
          {isCustomer && <p className="auth-switch">{signup ? "Already have an account?" : "New to AlphaBet?"} <Link href={signup ? "/login" : "/register"}>{signup ? "Sign in" : "Create an account"}</Link></p>}
          {!isCustomer && <p className="auth-secure"><ShieldCheck size={14} /> Authorized {role} workspace</p>}
        </div>
      </section>
    </main>
  );
}
