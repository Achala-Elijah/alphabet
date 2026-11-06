"use client";

import { useEffect, useState } from "react";
import { formatCustomerAmount } from "@/lib/currency";
import { copyText } from "@/lib/clipboard";

export type WinSelection = { match?: string; option?: string; odds?: number; market?: string };

export type WinCelebrationBet = {
  id: string;
  payout: number;
  stake: number;
  potential_return: number;
  /** Winning legs, when the caller has them — shown inside the Details panel. */
  selections?: WinSelection[] | null;
};

const CONFETTI = [
  { left: "7%", delay: "0s", color: "#f3cd69", width: 6, height: 14, round: false },
  { left: "14%", delay: ".5s", color: "#30d47a", width: 5, height: 11, round: true },
  { left: "23%", delay: "1.1s", color: "#f3cd69", width: 5, height: 10, round: false },
  { left: "31%", delay: ".25s", color: "#ffffff", width: 6, height: 12, round: false },
  { left: "39%", delay: "1.4s", color: "#30d47a", width: 5, height: 10, round: true },
  { left: "48%", delay: ".7s", color: "#f3cd69", width: 6, height: 13, round: false },
  { left: "57%", delay: ".1s", color: "#ffffff", width: 4, height: 9, round: true },
  { left: "66%", delay: "1.2s", color: "#30d47a", width: 6, height: 12, round: false },
  { left: "75%", delay: ".4s", color: "#f3cd69", width: 5, height: 11, round: true },
  { left: "84%", delay: "1.6s", color: "#ffffff", width: 4, height: 8, round: false },
  { left: "92%", delay: ".9s", color: "#30d47a", width: 6, height: 12, round: false }
];

/** Glowing particles that fly out of the trophy's mouth. */
const SPARKS = [
  { tx: "0px", ty: "-86px", delay: "0s" },
  { tx: "-58px", ty: "-48px", delay: ".35s" },
  { tx: "54px", ty: "-52px", delay: ".7s" },
  { tx: "-78px", ty: "10px", delay: "1.05s" },
  { tx: "74px", ty: "14px", delay: "1.4s" },
  { tx: "-32px", ty: "-74px", delay: "1.75s" },
  { tx: "36px", ty: "-26px", delay: "2.05s" }
];

/**
 * "YOU WON!" success popup — dark SportyBet-style card: white title, vivid
 * green amount, gold trophy with a light burst, verify code, and a
 * Details / Show Off button pair.
 */
export default function WinCelebration({ win, onClose, currency = "GHS" }: { win: WinCelebrationBet; onClose: () => void; currency?: string }) {
  const [showDetails, setShowDetails] = useState(false);
  const [shareLabel, setShareLabel] = useState("Show Off");
  const [sharing, setSharing] = useState(false);

  // Escape closes the popup.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const selections = Array.isArray(win.selections) ? win.selections : [];
  const headline = selections[0]?.match || (selections.length > 1 ? `${selections.length} selections` : "Winning slip");
  const totalOdds = win.stake > 0 ? win.potential_return / win.stake : 0;
  // A short, quotable reference support can look up (the bet's ID as a code).
  const verifyCode = win.id.replaceAll("-", "").slice(0, 12).toUpperCase();

  async function shareWin() {
    if (sharing) return;
    setSharing(true);
    const text = `I won ${formatCustomerAmount(win.payout, currency)} on AlphaBet! Verify code: ${verifyCode}`;
    const url = window.location.origin;
    try {
      if (navigator.share) {
        await navigator.share({ title: "AlphaBet win", text, url });
        setShareLabel("Shared!");
      } else {
        throw new Error("no-share");
      }
    } catch (reason) {
      // The user dismissing the native share sheet is not a failure.
      const dismissed = reason instanceof DOMException && reason.name === "AbortError";
      if (!dismissed) {
        try {
          await copyText(`${text} ${url}`);
          setShareLabel("Copied!");
        } catch {
          setShareLabel("Copy failed");
        }
      }
    } finally {
      setSharing(false);
      window.setTimeout(() => setShareLabel("Show Off"), 1900);
    }
  }

  return (
    <div
      className="win-celebration"
      role="dialog"
      aria-modal="true"
      aria-label="You won"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="win-celebration-card">
        <div className="win-celebration-confetti" aria-hidden="true">
          {CONFETTI.map((piece, index) => (
            <i
              key={index}
              style={{
                left: piece.left,
                animationDelay: piece.delay,
                background: piece.color,
                width: piece.width,
                height: piece.height,
                borderRadius: piece.round ? "50%" : "1px"
              }}
            />
          ))}
        </div>
        <div className="win-celebration-spotlight" aria-hidden="true" />

        <p className="win-eyebrow">Congratulations</p>
        <h2>YOU WON!</h2>
        <strong className="win-celebration-amount">{formatCustomerAmount(win.payout, currency)}</strong>
        <p className="win-celebration-sub">Your winnings have been credited to your wallet.</p>

        <div className="win-celebration-cup-wrap" aria-hidden="true">
          <div className="win-burst">
            {SPARKS.map((spark, index) => (
              <i key={index} style={{ "--tx": spark.tx, "--ty": spark.ty, animationDelay: spark.delay } as React.CSSProperties} />
            ))}
          </div>
          <svg className="win-celebration-cup" viewBox="0 0 192 180" aria-hidden="true">
            <defs>
              <linearGradient id="wonGold" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#fff2bc" />
                <stop offset=".18" stopColor="#f4d878" />
                <stop offset=".42" stopColor="#d6a93c" />
                <stop offset=".66" stopColor="#8f611d" />
                <stop offset=".84" stopColor="#e3c45e" />
                <stop offset="1" stopColor="#5e3b10" />
              </linearGradient>
              <linearGradient id="wonGoldBevel" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#7e5218" />
                <stop offset=".13" stopColor="#e8c85c" />
                <stop offset=".35" stopColor="#fff4b7" />
                <stop offset=".58" stopColor="#c09237" />
                <stop offset=".78" stopColor="#f2da85" />
                <stop offset="1" stopColor="#6e4514" />
              </linearGradient>
              <linearGradient id="wonGoldHandle" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#ffe58d" />
                <stop offset=".35" stopColor="#d7b552" />
                <stop offset=".72" stopColor="#6e4514" />
                <stop offset="1" stopColor="#d6b85d" />
              </linearGradient>
              <linearGradient id="wonDarkGreen" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#234f35" />
                <stop offset=".45" stopColor="#10291c" />
                <stop offset="1" stopColor="#06120c" />
              </linearGradient>
              <radialGradient id="wonShieldGlow" cx=".38" cy=".24" r=".86">
                <stop offset="0" stopColor="#5da77a" stopOpacity=".9" />
                <stop offset=".34" stopColor="#21472f" stopOpacity=".45" />
                <stop offset="1" stopColor="#000" stopOpacity=".65" />
              </radialGradient>
            </defs>

            <ellipse cx="96" cy="166" rx="67" ry="7" fill="#000" opacity=".56" />

            {/* Outer handles — heavy cast-metal loops. */}
            <path
              d="M42 57H18c-15 0-17 30 7 34 10 2 20 1 27-3"
              fill="none"
              stroke="url(#wonGoldHandle)"
              strokeWidth="14"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M150 57h24c15 0 17 30-7 34-10 2-20 1-27-3"
              fill="none"
              stroke="url(#wonGoldHandle)"
              strokeWidth="14"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Cup bowl and rim. */}
            <path
              d="M42 48h108v12c0 33-22 57-54 69-32-12-54-36-54-69V48Z"
              fill="url(#wonGold)"
              stroke="#2d1b08"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <path d="M45 60h102" stroke="#ffef9f" strokeWidth="2" opacity=".7" />
            <path
              d="M31 35h130a7 7 0 0 1 7 7v7a7 7 0 0 1-7 7H31a7 7 0 0 1-7-7v-7a7 7 0 0 1 7-7Z"
              fill="url(#wonGoldBevel)"
              stroke="#2d1b08"
              strokeWidth="2"
            />
            <path d="M31 42h130" stroke="#fff7c1" strokeWidth="1.4" opacity=".65" />

            {/* Embedded AlphaBet shield. */}
            <path
              d="M69 66h54l10 8v23c0 16-14 27-37 36-23-9-37-20-37-36V74l10-8Z"
              fill="url(#wonDarkGreen)"
              stroke="#dec15a"
              strokeWidth="2.4"
              strokeLinejoin="round"
            />
            <path
              d="M76 73h40l8 6v18c0 13-11 22-28 28-17-6-28-15-28-28V79l8-6Z"
              fill="url(#wonShieldGlow)"
              stroke="#e7cb6b"
              strokeWidth="1.1"
              opacity=".95"
            />
            <path d="M96 78l5.5 15.5 15.5 5.5-15.5 5.5L96 120l-5.5-15.5L75 99l15.5-5.5Z" fill="#fff4c0" opacity=".08" />
            <text
              x="96"
              y="112"
              textAnchor="middle"
              fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
              fontSize="26"
              fontWeight="950"
              letterSpacing="2.5"
              fill="#f4d979"
              stroke="#312006"
              strokeWidth=".65"
              paintOrder="stroke"
            >
              AB
            </text>

            {/* Stem and plinth. */}
            <path d="M82 130h28v14H82z" fill="url(#wonGoldHandle)" stroke="#2d1b08" strokeWidth="2" />
            <path
              d="M57 144h78l9 18H48l9-18Z"
              fill="url(#wonGold)"
              stroke="#2d1b08"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <path
              d="M45 164h102a5 5 0 0 1 5 5v1a5 5 0 0 1-5 5H45a5 5 0 0 1-5-5v-1a5 5 0 0 1 5-5Z"
              fill="url(#wonGoldHandle)"
              stroke="#2d1b08"
              strokeWidth="2"
            />
            <text
              x="96"
              y="170"
              textAnchor="middle"
              fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
              fontSize="6.2"
              fontWeight="900"
              letterSpacing="1.8"
              fill="#221407"
            >
              ALPHABET
            </text>
          </svg>
        </div>

        <p className="win-verify">Verify Code: <strong>{verifyCode}</strong></p>

        <div className="win-ticket" aria-label="Winning ticket summary">
          <p className="win-ticket-title">Winning Ticket</p>
          <dl className="win-celebration-meta">
            <div><dt>Stake</dt><dd>{formatCustomerAmount(win.stake, currency)}</dd></div>
            <div><dt>Total odds</dt><dd>{totalOdds > 0 ? totalOdds.toFixed(2) : "—"}</dd></div>
            <div className="is-gold"><dt>Total return</dt><dd>{formatCustomerAmount(win.potential_return, currency)}</dd></div>
            <div><dt>Ticket ID</dt><dd>{win.id.slice(0, 8).toUpperCase()}</dd></div>
          </dl>
        </div>

        {showDetails && selections.length > 0 && (
          <div className="win-details">
            <ul className="win-details-list">
              {selections.map((selection, index) => (
                <li key={index}>
                  <span>
                    {selection.match || "Selection"}
                    <small>{selection.option}{selection.market ? ` · ${selection.market}` : ""}</small>
                  </span>
                  {selection.odds ? <em>{Number(selection.odds).toFixed(2)}</em> : null}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="win-actions">
          <button
            type="button"
            className="win-btn win-btn-outline"
            onClick={() => setShowDetails((open) => !open)}
            aria-expanded={showDetails}
          >
            <span className="win-btn-text">
              <strong>{showDetails ? "Hide details" : "Details"}</strong>
              <small>{headline}</small>
            </span>
            <span className="win-btn-num">{totalOdds > 0 ? totalOdds.toFixed(2) : ""}</span>
          </button>
          <button type="button" className="win-btn win-btn-solid" onClick={() => void shareWin()} disabled={sharing}>
            {shareLabel}
          </button>
        </div>

        <footer className="win-footer">
          <span className="win-footer-mark" aria-hidden="true">A</span>
          <strong>Alpha<span>Bet</span></strong>
        </footer>
      </section>
    </div>
  );
}
