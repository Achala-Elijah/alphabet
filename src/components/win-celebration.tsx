"use client";

import { formatCustomerAmount } from "@/lib/currency";

export type WinCelebrationBet = {
  id: string;
  payout: number;
  stake: number;
  potential_return: number;
};

const CONFETTI = [
  { left: "5%", delay: "0s", color: "#ffd45e", width: 7, height: 13, round: false },
  { left: "13%", delay: ".5s", color: "#6ee7a0", width: 6, height: 10, round: true },
  { left: "21%", delay: "1.1s", color: "#ff6079", width: 8, height: 12, round: false },
  { left: "29%", delay: ".2s", color: "#7cc4ff", width: 5, height: 9, round: true },
  { left: "37%", delay: "1.4s", color: "#fff3b0", width: 7, height: 14, round: false },
  { left: "45%", delay: ".7s", color: "#6ee7a0", width: 6, height: 11, round: false },
  { left: "53%", delay: ".1s", color: "#ffd45e", width: 8, height: 13, round: true },
  { left: "61%", delay: "1.2s", color: "#ff6079", width: 5, height: 10, round: false },
  { left: "69%", delay: ".4s", color: "#7cc4ff", width: 7, height: 12, round: true },
  { left: "77%", delay: "1.6s", color: "#ffd45e", width: 6, height: 9, round: false },
  { left: "85%", delay: ".9s", color: "#6ee7a0", width: 8, height: 14, round: false },
  { left: "93%", delay: ".3s", color: "#fff3b0", width: 6, height: 11, round: true }
];

/** The "you won" pop-up shown right after a bet settles in the customer's favour. */
export default function WinCelebration({ win, onClose, currency = "GHS" }: { win: WinCelebrationBet; onClose: () => void; currency?: string }) {
  return (
    <div
      className="win-celebration"
      role="dialog"
      aria-modal="true"
      aria-label="Congratulations, you won"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="win-celebration-card">
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
                borderRadius: piece.round ? "50%" : "2px"
              }}
            />
          ))}
        </div>

        <div className="win-celebration-rays" aria-hidden="true" />
        <div className="win-celebration-sparkles" aria-hidden="true">
          <i className="spark spark-1">✦</i>
          <i className="spark spark-2">✦</i>
          <i className="spark spark-3">✦</i>
          <i className="spark spark-4">✦</i>
        </div>

        <div className="win-celebration-cup-wrap">
          <svg className="win-celebration-cup" viewBox="0 0 160 150" role="img" aria-label="AlphaBet golden trophy">
            <defs>
              <linearGradient id="abCupGold" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#fff6c4" />
                <stop offset=".25" stopColor="#ffd45e" />
                <stop offset=".52" stopColor="#e8a51b" />
                <stop offset=".78" stopColor="#ffcf5a" />
                <stop offset="1" stopColor="#b97608" />
              </linearGradient>
              <linearGradient id="abCupHandle" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#ffe9a8" />
                <stop offset="1" stopColor="#d39110" />
              </linearGradient>
              <linearGradient id="abCupBand" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#6d4404" />
                <stop offset=".5" stopColor="#2c1a02" />
                <stop offset="1" stopColor="#5a3803" />
              </linearGradient>
              <radialGradient id="abCupShade" cx=".35" cy=".25" r=".85">
                <stop offset="0" stopColor="#fff" stopOpacity=".55" />
                <stop offset="1" stopColor="#fff" stopOpacity="0" />
              </radialGradient>
            </defs>

            <ellipse cx="80" cy="142" rx="52" ry="7" fill="#000" opacity=".28" />

            <path
              d="M38 46h84v10c0 27-17 48-42 55-25-7-42-28-42-55V46Z"
              fill="url(#abCupGold)"
              stroke="#8a5806"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
            <path
              d="M38 54H27c-11 0-15 13-6 20 5 4 11 5 17 5"
              fill="none"
              stroke="url(#abCupHandle)"
              strokeWidth="7"
              strokeLinecap="round"
            />
            <path
              d="M122 54h11c11 0 15 13 6 20-5 4-11 5-17 5"
              fill="none"
              stroke="url(#abCupHandle)"
              strokeWidth="7"
              strokeLinecap="round"
            />
            <path d="M47 55c2 20 13 37 28 46-16-3-30-20-32-42 1-2 2-3 4-4Z" fill="url(#abCupShade)" />

            <rect x="32" y="35" width="96" height="15" rx="7.5" fill="url(#abCupGold)" stroke="#8a5806" strokeWidth="2.5" />
            <path d="M44 46h72" stroke="#fff6c4" strokeWidth="2" strokeLinecap="round" opacity=".75" />

            <rect x="62" y="66" width="36" height="31" rx="8" fill="url(#abCupBand)" stroke="#ffd45e" strokeWidth="2" />
            <text
              x="80"
              y="89"
              textAnchor="middle"
              fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
              fontSize="18"
              fontWeight="900"
              letterSpacing="1"
              fill="#ffe9a8"
            >
              AB
            </text>

            <path d="M70 108h20v14H70z" fill="url(#abCupHandle)" stroke="#8a5806" strokeWidth="2.5" strokeLinejoin="round" />
            <path d="M54 122h52l7 13H47Z" fill="url(#abCupGold)" stroke="#8a5806" strokeWidth="2.5" strokeLinejoin="round" />
            <rect x="41" y="135" width="78" height="9" rx="4.5" fill="url(#abCupHandle)" stroke="#8a5806" strokeWidth="2.5" />
            <text
              x="80"
              y="141.5"
              textAnchor="middle"
              fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
              fontSize="5.5"
              fontWeight="800"
              letterSpacing="1.2"
              fill="#6d4404"
            >
              ALPHABET
            </text>

            <circle cx="112" cy="36" r="3" fill="#fff6c4" opacity=".9" />
            <circle cx="121" cy="44" r="1.8" fill="#fff6c4" opacity=".65" />
          </svg>
        </div>

        <span className="win-celebration-brand">ALPHABET</span>
        <h2>YOU WON!</h2>
        <p className="win-celebration-sub">Your bet came through — enjoy your winnings</p>
        <strong className="win-celebration-amount">{formatCustomerAmount(win.payout, currency)}</strong>

        <div className="win-celebration-meta">
          <span>Bet <b>{win.id.slice(0, 8).toUpperCase()}</b></span>
          <span>Stake <b>{formatCustomerAmount(win.stake, currency)}</b></span>
          <span>Return <b>{formatCustomerAmount(win.potential_return, currency)}</b></span>
        </div>

        <button type="button" onClick={onClose}>AWESOME!</button>
      </div>
    </div>
  );
}
