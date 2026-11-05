"use client";

import { Check, Copy, Loader2, Share2, Ticket } from "lucide-react";
import { useEffect, useState } from "react";
import { formatBookingCode } from "@/lib/bet-slip";
import { formatCustomerAmount } from "@/lib/currency";
import type { BetSlipSelection } from "@/lib/bet-slip";

export type PlacedBetReceipt = {
  ids: string[];
  count: number;
  mode: "multiple" | "singles";
  stake: number;
  potentialReturn: number;
  selections: BetSlipSelection[];
  /** Shareable code generated for this placed slip. */
  bookingCode?: string | null;
  codeStake?: string;
  codeError?: string | null;
  codeLoading?: boolean;
};

/** SportyBet-style receipt shown the moment a bet is accepted. */
export default function BetPlaced({
  receipt,
  currency,
  onClose,
  onRetryCode
}: {
  receipt: PlacedBetReceipt;
  currency: string;
  onClose: () => void;
  onRetryCode?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [shareNotice, setShareNotice] = useState("");
  const totalOdds = receipt.selections.reduce((total, selection) => total * Number(selection.odds || 1), 1);
  const isSingles = receipt.mode === "singles";
  const displayCode = receipt.bookingCode ? formatBookingCode(receipt.bookingCode) : "";

  useEffect(() => {
    setCopied(false);
    setShareNotice("");
  }, [receipt.bookingCode]);

  async function copyCode() {
    if (!receipt.bookingCode) return;
    try {
      await navigator.clipboard.writeText(receipt.bookingCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setShareNotice("Could not copy — long-press and copy the code manually.");
    }
  }

  async function shareCode() {
    if (!receipt.bookingCode) return;
    const code = receipt.bookingCode;
    const text = `I'm betting on AlphaBet. Load my slip with code ${formatBookingCode(code)}`;
    const url = `${window.location.origin}/?code=${encodeURIComponent(code)}`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "AlphaBet booking code", text, url });
        return;
      } catch {
        return; // user dismissed the native share sheet
      }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setShareNotice("Sharing is unavailable — copy the code instead.");
    }
  }
  return (
    <div className="bet-placed" role="dialog" aria-modal="true" aria-label="Bet placed successfully" onClick={onClose}>
      <div className="bet-placed-card" onClick={(event) => event.stopPropagation()}>
        <span className="bet-placed-icon"><Check size={30} strokeWidth={3} /></span>
        <h2>Bet placed successfully</h2>
        <p>{receipt.count > 1 ? `${receipt.count} single bets accepted` : "Your bet has been accepted"}</p>

        <div className="bet-placed-id bet-placed-booking-code">
          <Ticket size={15} />
          <span>Booking code</span>
          {receipt.codeLoading ? (
            <strong className="bet-placed-code-loading"><Loader2 size={15} className="spin" /> Creating code…</strong>
          ) : displayCode ? (
            <div className="bet-placed-code-row">
              <strong>{displayCode}</strong>
              <div className="bet-placed-code-actions">
                <button type="button" onClick={() => void copyCode()} aria-label="Copy booking code">
                  <Copy size={13} /> {copied ? "Copied" : "Copy"}
                </button>
                <button type="button" onClick={() => void shareCode()} aria-label="Share booking code">
                  <Share2 size={13} /> Share
                </button>
              </div>
            </div>
          ) : (
            <div className="bet-placed-code-error">
              <strong>{receipt.codeError || "Could not create a booking code."}</strong>
              {onRetryCode && (
                <button type="button" onClick={onRetryCode}>Try again</button>
              )}
            </div>
          )}
          {shareNotice && <small className="bet-placed-code-notice">{shareNotice}</small>}
        </div>

        <div className="bet-placed-rows">
          <div><span>Type</span><strong>{isSingles ? `Singles (${receipt.count})` : "Multiple"}</strong></div>
          <div><span>Stake</span><strong>{formatCustomerAmount(receipt.stake, currency)}</strong></div>
          <div><span>Total odds</span><strong>{totalOdds.toFixed(2)}</strong></div>
          <div className="is-highlight"><span>Potential win</span><strong>{formatCustomerAmount(receipt.potentialReturn, currency)}</strong></div>
        </div>

        <div className="bet-placed-selections">
          {receipt.selections.map((selection, index) => (
            <div key={`${selection.matchId}-${selection.market}-${selection.option}-${index}`}>
              <span>{selection.option} @ {Number(selection.odds).toFixed(2)}</span>
              <small>{selection.match} · {selection.market}</small>
              {isSingles && selection.stake ? (
                <em>Stake {formatCustomerAmount(Number(selection.stake), currency)}</em>
              ) : null}
            </div>
          ))}
        </div>

        <button type="button" onClick={onClose}>OK</button>
      </div>
    </div>
  );
}
