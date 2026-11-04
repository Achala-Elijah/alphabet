import Link from "next/link";
import { Suspense } from "react";
import { Trophy, Wallet, UserRound, Headphones, Heart, History, ChevronRight, ShieldCheck } from "lucide-react";
import ClientHeader from "@/components/client-header";
import ClientBottomNav from "@/components/client-bottom-nav";
import CustomerLogoutButton from "@/components/customer-logout-button";
import { getCustomerSession } from "@/lib/custom-auth";
import CustomerBets from "@/components/customer-bets";
import CustomerWallet from "@/components/customer-wallet";
import MyMatches from "@/components/my-matches";
import CustomerAccount from "@/components/customer-account";
import WalletActions from "@/components/wallet-actions";
import { formatCustomerAmount } from "@/lib/currency";
import { minDeposit } from "@/lib/limits";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type StaffSession = { username: string; balance: number; role: "admin" | "sub_admin" };

const menu = [
  { label: "My Matches", Icon: Trophy, href: "/account?nav=matches" },
  { label: "My Wallet", Icon: Wallet },
  { label: "My Account", detail: "Country & email", Icon: UserRound },
  { label: "Customer Service", detail: "Online 24/7", Icon: Headphones },
  { label: "Promotions", Icon: Heart },
  { label: "Transaction History", Icon: History }
];

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ nav?: string; reference?: string; trxref?: string }> }) {
  let staff: StaffSession | null = null;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: profile } = await supabase.from("profiles").select("username,phone,role,balance").eq("id", user.id).single();
    if (profile && (profile.role === "admin" || profile.role === "sub_admin")) {
      staff = { username: profile.username || profile.phone || "Staff", balance: Number(profile.balance || 0), role: profile.role };
    }
  }
  const customer = staff ? null : await getCustomerSession();
  const nav = (await searchParams).nav;
  const isBets = nav === "bets";
  const isWallet = nav === "wallet" || nav === "transactions";
  const isMatches = nav === "matches";
  const isAccount = nav === "account";
  if (isBets) {
    return <div className="client-app account-page"><ClientHeader /><main className="account-main">
      {customer || staff ? <CustomerBets /> : <div className="customer-bets-empty"><UserRound size={27} /><strong>Sign in to view your bets</strong><Link href="/login">Customer sign in</Link></div>}
    </main><Suspense fallback={null}><ClientBottomNav /></Suspense></div>;
  }
  if (isMatches) {
    return <div className="client-app account-page"><ClientHeader /><main className="account-main"><MyMatches /></main><Suspense fallback={null}><ClientBottomNav /></Suspense></div>;
  }
  if (isAccount) {
    return <div className="client-app account-page"><ClientHeader /><main className="account-main">    {customer ? <CustomerAccount username={customer.username} email={customer.email} currency={customer.currency} /> : staff ? <div className="customer-bets-empty"><UserRound size={27} /><strong>{staff.role === "admin" ? "Admin account" : "Sub-admin account"}</strong><span>Staff profile settings are managed in your workspace.</span><Link href="/sub-admin/settings">Open settings</Link></div> : <div className="customer-bets-empty"><UserRound size={27} /><strong>Sign in to manage your account</strong><Link href="/login">Customer sign in</Link></div>}</main><Suspense fallback={null}><ClientBottomNav /></Suspense></div>;
  }
  if (isWallet) {
    let paymentNotice: { kind: "success" | "error"; text: string } | null = null;
    let currentBalance = customer?.balance ?? staff?.balance ?? 0;

    // The payment gateway returns here after checkout. We verify and settle
    // the deposit; the webhook is the backup path.
    const params = await searchParams;
    const ref = params.reference || params.trxref;

    if (ref && (customer || staff)) {
      try {
        const { paymentsClient, verifyAndSettle } = await import("@/lib/payments/service");
        const subject = customer
          ? { type: "customer" as const, accountId: customer.account_id }
          : { type: "staff" as const, staffId: user!.id };
        const settleResult = await verifyAndSettle(paymentsClient(), ref, subject);
        if (settleResult.status === "paid") {
          currentBalance = settleResult.balance;
          paymentNotice = {
            kind: "success",
            text: `Payment confirmed! ${formatCustomerAmount(settleResult.balance, customer?.currency || "GHS")} is your new balance.`
          };
        } else if (settleResult.status === "failed") {
          paymentNotice = { kind: "error", text: "The payment could not be completed or was cancelled." };
        }
      } catch (err) {
        console.error("Auto verify on return failed:", err);
      }
    }

    let transactions: Array<{ id: string; type: string; amount: number; status: string; reference: string | null; created_at: string }> = [];
    if (customer) {
      const supabase = await import("@/lib/supabase/server").then((module) => module.createSupabaseServerClient());
      const result = await supabase.rpc("customer_transaction_history", { p_account_id: customer.account_id });
      transactions = result.data || [];
    }
    return <div className="client-app account-page"><ClientHeader /><main className="account-main">
      {customer ? <CustomerWallet balance={currentBalance} currency={customer.currency} initialTransactions={transactions} title={nav === "transactions" ? "Transaction History" : "My Wallet"} paymentNotice={paymentNotice} /> : staff ? <div className="customer-bets-empty"><Wallet size={27} /><strong>Staff wallet</strong><span>Your staff balance is {formatCustomerAmount(staff.balance, "GHS")}.</span><WalletActions mode="staff" layout="summary" /><Link href="/sub-admin">Open workspace</Link></div> : <div className="customer-bets-empty"><UserRound size={27} /><strong>Sign in to view your wallet</strong><Link href="/login">Customer sign in</Link></div>}
    </main><Suspense fallback={null}><ClientBottomNav /></Suspense></div>;
  }
  return <div className="client-app account-page"><ClientHeader /><main className="account-main">
    {customer || staff ? <section className="account-profile-summary">
      <span className="profile-summary-avatar">{(customer?.username || staff?.username || "ST").slice(0, 2).toUpperCase()}</span>
      <h1>{customer?.username || staff?.username}</h1>
      <p>{staff ? (staff.role === "admin" ? "Ghana · Admin account" : "Ghana · Sub-admin account") : "Ghana · Customer account"}</p>
      <strong>{formatCustomerAmount(customer?.balance ?? staff?.balance ?? 0, customer?.currency || "GHS")}</strong>
      <WalletActions mode={staff ? "staff" : "customer"} currency={customer?.currency || "GHS"} layout="summary" />
    </section> : <section className="account-profile-summary account-profile-guest">
      <span className="profile-summary-avatar"><UserRound size={25} /></span>
      <h1>Welcome to AlphaBet</h1>
      <p>Sign in to manage your account and wallet.</p>
      <Link href="/login">Customer sign in</Link>
    </section>}
    <div className="account-list">
      {staff && <Link href="/sub-admin" className="account-item"><ShieldCheck size={31} strokeWidth={1.8} /><span className="account-label">{staff.role === "admin" ? "Admin Dashboard" : "Sub-admin Dashboard"}</span><small>Staff workspace</small><ChevronRight size={23} className="chevron" /></Link>}
      {menu.map(({ label, detail, Icon, href }) => {
        // "My Wallet" advertises the deposit floor right on the menu row so
        // the limit is visible before the user even opens the wallet.
        const rowDetail = label === "My Wallet"
          ? `Min deposit ${formatCustomerAmount(minDeposit(customer?.currency), customer?.currency)}`
          : detail;
        return <Link href={href || (label === "My Matches" ? "/account?nav=matches" : label === "My Wallet" ? "/account?nav=wallet" : label === "My Account" ? "/account?nav=account" : label === "Transaction History" ? "/account?nav=transactions" : "#")} key={label} className="account-item"><Icon size={31} strokeWidth={1.8} /><span className="account-label">{label}</span>{rowDetail && <small>{rowDetail}</small>}<ChevronRight size={23} className="chevron" /></Link>;
      })}
      {customer ? <CustomerLogoutButton /> : null}
    </div>
    <footer className="client-footer">18+ &nbsp; • &nbsp; Play Responsibly<br />© 2026 AlphaBet. All rights reserved.</footer>
  </main><Suspense fallback={null}><ClientBottomNav /></Suspense></div>;
}
