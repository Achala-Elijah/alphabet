"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CustomerLogoutButton() {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    setLoggingOut(true);
    await fetch("/api/auth/customer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" })
    });
    router.push("/");
    router.refresh();
  }

  return (
    <button type="button" className="account-item logout" onClick={logout} disabled={loggingOut}>
      <span className="account-label">{loggingOut ? "Logging out..." : "Log Out"}</span>
    </button>
  );
}
