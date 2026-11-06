"use client";

import { useState } from "react";
import { copyText } from "@/lib/clipboard";

export default function CopyReferralLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  async function copy() {
    try {
      await copyText(`${window.location.origin}/register?ref=${code}`);
      setCopied(true);
      setFailed(false);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setFailed(true);
    }
  }
  return <div className="referral-action"><code>/register?ref={code}</code><button type="button" className="copy-referral-button" onClick={() => void copy()}>{copied ? "Copied" : failed ? "Copy failed" : "Copy link"}</button></div>;
}
