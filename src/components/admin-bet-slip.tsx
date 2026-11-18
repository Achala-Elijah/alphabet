"use client";

import { useEffect, useState } from "react";
import WinCelebration, { type WinCelebrationBet } from "@/components/win-celebration";
import { formatCustomerAmount } from "@/lib/currency";
import { formatKickoff } from "@/lib/kickoff";

export type AdminBetSlipRow = {
  id: string;
  stake: number;
  potential_return: number;
  status: string;
  selections: unknown;
  placed_at: string;
};

export type AdminBetSlipTableProps = {
  /** Title shown above the table */
  title: string;
  /** Bets to render (open, won, lost or void — caller scopes them) */
  bets: AdminBetSlipRow[];
  /** Customer's currency (e.g. "GHS" or "NGN") */
  currency: string;
  /** Empty-state message when there are no bets */
  empty?: string;
  /** Pass true for the Open Bets view (shows the selection count instead of a status badge) */
  showSelections?: boolean;
};

/**
 * Renders a table of bet slips with clickable rows for admin/sub-admins.
 * Clicking a settled, winning slip opens the WinCelebration popup; open,
 * lost and void slips are clickable but do nothing.
 */
export default function AdminBetSlipTable({
  title,
  bets,
  currency,
  empty = "No bets found.",
  showSelections = false,
}: AdminBetSlipTableProps) {
  const headers = showSelections
    ? ["Bet ID", "Stake", "Potential return", "Selections", "Kickoff"]
    : ["Bet ID", "Stake", "Potential return", "Status", "Kickoff"];

  const [activeWin, setActiveWin] = useState<WinCelebrationBet | null>(null);
  const [kickoffs, setKickoffs] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    async function loadKickoffs() {
      const ids = [...new Set(bets.flatMap((bet) => Array.isArray(bet.selections)
        ? (bet.selections as Array<{ matchId?: string }>).map((selection) => selection.matchId || "").filter(Boolean)
        : []))];
      if (ids.length === 0) {
        if (!cancelled) setKickoffs({});
        return;
      }
      try {
        const response = await fetch(`/api/sports/live?matchIds=${encodeURIComponent(ids.join(","))}`, { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json() as { matches?: Array<{ slug?: string; time?: string }> };
        const times: Record<string, string> = {};
        for (const match of data.matches || []) {
          if (match.slug) times[match.slug] = match.time || "";
        }
        if (!cancelled) setKickoffs(times);
      } catch {
        // Kickoff lookup failed — the cells fall back to "Time unavailable".
      }
    }
    void loadKickoffs();
    return () => { cancelled = true; };
  }, [bets]);

  function openWinCelebration(bet: AdminBetSlipRow) {
    const normalizedStatus = String(bet.status || "").trim().toLowerCase();
    if (normalizedStatus !== "won") {
      return;
    }
    const selections = Array.isArray(bet.selections)
      ? (bet.selections as { match?: string; option?: string; odds?: number; market?: string }[])
      : null;
    setActiveWin({
      id: bet.id,
      payout: Number(bet.potential_return) || 0,
      stake: Number(bet.stake) || 0,
      potential_return: Number(bet.potential_return) || 0,
      selections,
    });
  }

  function kickoffText(bet: AdminBetSlipRow) {
    if (!Array.isArray(bet.selections)) return "Time unavailable";
    const times = [...new Set((bet.selections as Array<{ matchId?: string }>)
      .map((selection) => selection.matchId ? kickoffs[selection.matchId] : "")
      .filter((value): value is string => Boolean(value)))]
      .map(formatKickoff);
    return times.length ? times.join(" · ") : "Time unavailable";
  }

  return (
    <section className="admin-card table-card customer-activity-card">
      <div className="card-heading">
        <div>
          <h2>{title}</h2>
          <p>Bet records for this account.</p>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{headers[0]}</th>
              <th>{headers[1]}</th>
              <th>{headers[2]}</th>
              <th>{headers[3]}</th>
              <th>{headers[4]}</th>
            </tr>
          </thead>
          <tbody>
            {bets.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty-table">{empty}</td>
              </tr>
            ) : (
              bets.map((bet) => (
                <tr
                  key={bet.id}
                  style={{ cursor: "pointer" }}
                  role="button"
                  tabIndex={0}
                  onClick={() => openWinCelebration(bet)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openWinCelebration(bet);
                    }
                  }}
                  aria-label={`Bet ${bet.id.slice(0, 8).toUpperCase()}: ${bet.status.toUpperCase()}, stake ${formatCustomerAmount(bet.stake, currency)}`}
                >
                  <td className="id-cell">{bet.id.slice(0, 8).toUpperCase()}</td>
                  <td className="amount-cell">{formatCustomerAmount(bet.stake, currency)}</td>
                  <td className="amount-cell">{formatCustomerAmount(bet.potential_return, currency)}</td>
                  <td>
                    {showSelections ? (
                      Array.isArray(bet.selections) ? bet.selections.length : "—"
                    ) : (
                      <>
                        <span className={`status ${bet.status.toLowerCase()}`}>{bet.status}</span>
                        {bet.status.toLowerCase() === "won" && (
                          <button
                            type="button"
                            className="win-ticket-link"
                            onClick={(event) => {
                              event.stopPropagation();
                              openWinCelebration(bet);
                            }}
                            aria-label={`View winning ticket ${bet.id.slice(0, 8)}`}
                          >
                            View ticket
                          </button>
                        )}
                      </>
                    )}
                  </td>
                  <td>{kickoffText(bet)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {activeWin && (
        <WinCelebration
          win={activeWin}
          onClose={() => setActiveWin(null)}
          currency={currency}
        />
      )}
    </section>
  );
}