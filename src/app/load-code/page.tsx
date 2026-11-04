"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Booking codes are handled entirely inside the bet slip (SportyBet style).
 * This page exists only as a redirect so old links/bookmarks like
 * /load-code?code=X7K2P land on the homepage where the slip lives.
 */
export default function LoadCodePage() {
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code") || params.get("booking") || params.get("ref") || "";
    router.replace(code ? `/?code=${encodeURIComponent(code)}` : "/");
  }, [router]);

  return (
    <div className="load-code-page">
      <p className="load-code-redirect">Loading your bet slip…</p>
    </div>
  );
}
