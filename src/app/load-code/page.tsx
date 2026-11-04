"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, LoaderCircle, Ticket, CheckCircle2, AlertCircle, Search, Trash2, Copy, CheckCheck, Share2 } from "lucide-react";
import { normalizeBookingCode, isValidBookingCode, deserializeBetSlipFromCode, writeBetSlip } from "@/lib/bet-slip";

type LoadedSlip = {
  code: string;
  selections: Array<{ match: string; matchId: string; option: string; odds: string | number; market: string }>;
  stake: string;
  createdAt: string;
  expiresAt: string;
};

const CODE_LENGTH = 8; // "AB" + 6

export default function LoadCodePage() {
  const [codeChars, setCodeChars] = useState<string[]>(Array(CODE_LENGTH).fill(""));
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [loaded, setLoaded] = useState<LoadedSlip | null>(null);
  const [copied, setCopied] = useState(false);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const code = codeChars.join("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("code") || params.get("booking") || params.get("ref") || "";
    if (fromUrl) {
      fillFromPaste(fromUrl);
    }
    // Don't pre-focus or pre-fill — the user just sees 8 empty boxes.
    const handlePaste = (event: ClipboardEvent) => {
      const pasted = event.clipboardData?.getData("text") || "";
      if (pasted && isValidBookingCode(pasted)) {
        event.preventDefault();
        fillFromPaste(pasted);
      }
    };
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, []);

  function fillFromPaste(text: string) {
    const normalized = normalizeBookingCode(text);
    const chars = normalized.split("").slice(0, CODE_LENGTH);
    setCodeChars([...chars, ...Array(CODE_LENGTH - chars.length).fill("")]);
  }

  async function load() {
    if (!isValidBookingCode(code)) {
      setNotice({ kind: "error", text: "Enter a valid booking code (e.g. AB X7K2P)." });
      return;
    }
    setLoading(true);
    setNotice(null);
    setLoaded(null);
    try {
      const response = await fetch(`/api/booking-codes?code=${encodeURIComponent(code)}`, { cache: "no-store" });
      const data = await response.json() as { code?: string; selections?: LoadedSlip["selections"]; stake?: string; createdAt?: string; expiresAt?: string; error?: string };
      if (!response.ok) throw new Error(data.error || "Could not load this booking code.");
      const slip: LoadedSlip = {
        code: data.code || code,
        selections: data.selections || [],
        stake: data.stake || "150",
        createdAt: data.createdAt || new Date().toISOString(),
        expiresAt: data.expiresAt || ""
      };
      setLoaded(slip);
      setNotice({ kind: "success", text: `Booking code ${slip.code} loaded! ${slip.selections.length} selection${slip.selections.length === 1 ? "" : "s"} restored to your bet slip.` });
      // Save to localStorage — the bet slip on the homepage will pick it up.
      writeBetSlip(deserializeBetSlipFromCode({
        selections: slip.selections.map((s) => ({ ...s, odds: String(s.odds) })),
        stake: slip.stake
      }));
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not load this booking code." });
    } finally {
      setLoading(false);
    }
  }

  const combinedOdds = (loaded?.selections || []).reduce((total, sel) => total * Number(sel.odds || 1), 1);

  function handleCharChange(index: number, value: string) {
    // Pasting into a single box (browser may deliver the whole string to
    // the focused box) — spread it across all boxes and submit.
    if (value.length > 1) {
      fillFromPaste(value);
      return;
    }
    const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    setCodeChars((current) => {
      const next = [...current];
      next[index] = cleaned;
      return next;
    });
    if (cleaned && index < CODE_LENGTH - 1) inputRefs.current[index + 1]?.focus();
  }

  function handlePaste(index: number, event: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData("text");
    if (pasted) {
      event.preventDefault();
      fillFromPaste(pasted);
    }
  }

  function handleKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !codeChars[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void load();
    }
  }

  async function copyLoadedCode() {
    if (!loaded) return;
    try {
      await navigator.clipboard.writeText(loaded.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setNotice({ kind: "error", text: "Could not copy — select the code and copy it manually." });
    }
  }

  return (
    <div className="load-code-page">
      <header className="load-code-header">
        <a href="/" className="load-code-back"><ArrowLeft size={17} /> Back to sportsbook</a>
        <span className="load-code-logo">Alpha<span>Bet</span></span>
      </header>

      <main className="load-code-main">
        <section className="load-code-card">
          <div className="load-code-hero">
            <div className="load-code-icon"><Ticket size={26} /></div>
            <span className="auth-eyebrow">RELOAD A BET SLIP</span>
            <h1>Paste your booking code</h1>
            <p>Have a booking code from a friend? Paste it into the boxes below — we&apos;ll fill them in and load the selections straight into your bet slip.</p>
            <p className="load-code-paste-note">You can also just paste anywhere on this page.</p>
          </div>

          <div className="load-code-code-input">
            {codeChars.map((char, index) => (
              <input
                key={index}
                ref={(el) => { inputRefs.current[index] = el; }}
                value={char}
                onChange={(event) => handleCharChange(index, event.target.value)}
                onKeyDown={(event) => handleKeyDown(index, event)}
                onPaste={(event) => handlePaste(index, event)}
                maxLength={1}
                inputMode="text"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                className={`load-code-char ${index === 1 ? "load-code-char-gap" : ""}`}
                disabled={loading}
                aria-label={`Character ${index + 1} of booking code`}
                placeholder="·"
              />
            ))}
          </div>
          <p className="load-code-hint">Type <code>AB X7K2P</code> or just paste it — we fill the boxes for you, then press Load slip.</p>

          <button type="button" className="load-code-submit" onClick={() => void load()} disabled={loading || !isValidBookingCode(code)}>
            {loading ? <><LoaderCircle size={16} className="spin" /> Loading slip…</> : <><Search size={16} /> Load slip</>}
          </button>

          {notice && (
            <p className={`load-code-notice ${notice.kind}`}>
              {notice.kind === "success" ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
              {notice.text}
            </p>
          )}

          {loaded && (
            <div className="load-code-preview">
              <div className="load-code-preview-heading">
                <div>
                  <h2>Loaded slip</h2>
                  <span className="load-code-preview-code">
                    <code>{loaded.code.slice(0, 2)} {loaded.code.slice(2)}</code>
                    <button type="button" onClick={() => void copyLoadedCode()} aria-label="Copy booking code">
                      {copied ? <CheckCheck size={14} /> : <Copy size={14} />}
                    </button>
                  </span>
                  <span className="load-code-preview-date">{new Date(loaded.createdAt).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}</span>
                </div>
                <span className="load-code-preview-count">{loaded.selections.length} selection{loaded.selections.length === 1 ? "" : "s"}</span>
              </div>
              <ul className="load-code-selections">
                {loaded.selections.map((sel, index) => (
                  <li key={index}>
                    <div className="load-code-selection-main">
                      <strong>{sel.option}</strong>
                      <span className="load-code-selection-odds">{Number(sel.odds).toFixed(2)}</span>
                    </div>
                    <small>{sel.match} · {sel.market}</small>
                  </li>
                ))}
              </ul>
              <div className="load-code-summary">
                <div><span>Stake</span><strong>GH₵ {Number(loaded.stake).toFixed(2)}</strong></div>
                <div><span>Combined odds</span><strong>{combinedOdds.toFixed(2)}</strong></div>
                <div className="load-code-summary-highlight"><span>Potential</span><strong>GH₵ {(Number(loaded.stake) * combinedOdds).toFixed(2)}</strong></div>
              </div>
              <div className="load-code-actions">
                <a href="/" className="load-code-cta">Go to bet slip →</a>
                <button type="button" className="load-code-clear" onClick={() => { setLoaded(null); setNotice(null); setCodeChars(Array(CODE_LENGTH).fill("")); writeBetSlip({ selections: {}, stake: "150" }); inputRefs.current[0]?.focus(); }}>
                  <Trash2 size={14} /> Clear &amp; load another
                </button>
              </div>
              <small className="load-code-expires">This code expires on {loaded.expiresAt ? new Date(loaded.expiresAt).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : "soon"}.</small>
            </div>
          )}

          <div className="load-code-how">
            <h3><Share2 size={14} /> How it works</h3>
            <ol>
              <li>A friend taps <strong>Share (booking code)</strong> on their bet slip.</li>
              <li>They get a code like <code>AB X7K2P</code> and share it with you.</li>
              <li>You type it above — selections load into your bet slip.</li>
            </ol>
            <small>Codes expire after 7 days. Anyone with the code can load the same selections; placing the bet is always with your own stake.</small>
          </div>
        </section>
      </main>
    </div>
  );
}
