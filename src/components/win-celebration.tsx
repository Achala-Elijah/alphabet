"use client";

import { Trophy } from "lucide-react";
import { formatCustomerAmount } from "@/lib/currency";

export type WinCelebrationBet = {
  id: string;
  payout: number;
  stake: number;
  potential_return: number;
};

const CONFETTI = [
  { left: "6%", delay: "0s", color: "#ffd45e" },
  { left: "16%", delay: ".4s", color: "#6ee7a0" },
  { left: "27%", delay: ".9s", color: "#ff6079" },
  { left: "38%", delay: ".2s", color: "#7cc4ff" },
  { left: "49%", delay: "1.1s", color: "#ffd45e" },
  { left: "60%", delay: ".6s", color: "#6ee7a0" },
  { left: "71%", delay: "1.4s", color: "#ff6079" },
  { left: "82%", delay: ".3s", color: "#7cc4ff" },
  { left: "92%", delay: ".8s", color: "#ffd45e" }
];

/** The "you won" pop-up shown right after a bet settles in the customer's favour. */
export default function WinCelebration({ win, onClose, currency = "GHS" }: { win: WinCelebrationBet; onClose: () => void; currency?: string }) {
  return (
    <div className="win-celebration" role="dialog" aria-modal="true" aria-label="Congratulations, you won">
      <div className="win-celebration-card">
        <div className="win-celebration-confetti" aria-hidden="true">
          {CONFETTI.map((piece, index) => (
            <i key={index} style={{ left: piece.left, animationDelay: piece.delay, background: piece.color }} />
          ))}
        </div>
        <span className="win-celebration-trophy"><Trophy size={30} /></span>
        <h2>CONGRATULATIONS!</h2>
        <p>You won</p>
        <strong className="win-celebration-amount">{formatCustomerAmount(win.payout, currency)}</strong>
        <small>
          Bet {win.id.slice(0, 8).toUpperCase()} · Stake {formatCustomerAmount(win.stake, currency)} · Return {formatCustomerAmount(win.potential_return, currency)}
        </small>
        <button type="button" onClick={onClose}>AWESOME</button>
      </div>
    </div>
  );
}
