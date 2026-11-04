"use client";

import { useState } from "react";

export default function CopyReferralLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(`${window.location.origin}/register?ref=${code}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }
  return <div className="referral-action"><code>/register?ref={code}</code><button type="button" className="copy-referral-button" onClick={() => void copy()}>{copied ? "Copied" : "Copy link"}</button></div>;
}
