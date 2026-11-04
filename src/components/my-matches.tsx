"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Ticket } from "lucide-react";
import { formatCustomerAmount } from "@/lib/currency";

type CustomerBet = {
  id: string;
  stake: number;
  potential_return: number;
  status: string;
  selections: Array<{ match?: string; option?: string; odds?: number; market?: string }>;
  placed_at: string;
};

export default function MyMatches() {
  const [bets, setBets] = useState<CustomerBet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadActiveBets() {
    setLoading(true);
    try {
      const response = await fetch("/api/bets", { cache: "no-store" });
      const result = await response.json() as { bets?: CustomerBet[]; error?: string };
      if (!response.ok) throw new Error(result.error || "Unable to load your active bets.");
      setBets((result.bets || []).filter((bet) => bet.status === "open"));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load your active bets.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadActiveBets(); }, []);

  return (
    <section className="my-matches">
      <div className="my-matches-heading">
        <div>
          <h1>My Matches</h1>
          <p className="my-matches-subtitle">Your paid, ongoing bets only</p>
        </div>
        <button onClick={() => void loadActiveBets()} aria-label="Refresh active bets"><RefreshCw size={17} /></button>
      </div>
      {loading && <div className="my-matches-card my-matches-empty">Loading your active bets...</div>}
      {!loading && error && <div className="my-matches-card my-matches-empty">{error}<button onClick={() => void loadActiveBets()}>Try again</button></div>}
      {!loading && !error && bets.length === 0 && (
        <div className="my-matches-card my-matches-empty">
          <Ticket size={30} />
          <strong>No ongoing bets</strong>
          <span>Only bets you have placed and paid for will appear here. Unpaid selections remain on the sportsbook bet slip.</span>
        </div>
      )}
      {!loading && !error && bets.map((bet) => (
        <article className="my-matches-card my-matches-placed-card" key={bet.id}>
          <div className="my-matches-card-heading">
            <span><Ticket size={17} /> Bet {bet.id.slice(0, 8).toUpperCase()}</span>
            <strong className="bet-status bet-status-open">Ongoing</strong>
          </div>
          <div className="my-matches-selections">
            {bet.selections.map((selection, index) => (
              <div className="my-match-selection" key={`${bet.id}-${index}`}>
                <span>
                  <strong>{selection.option || "Selection"} @ {Number(selection.odds || 0).toFixed(2)}</strong>
                  <small>{selection.match || "Match"} · {selection.market || "Market"}</small>
                </span>
              </div>
            ))}
          </div>
          <div className="my-matches-return">
            <span>Stake <strong>{formatCustomerAmount(bet.stake)}</strong></span>
            <span>Potential return <strong>{formatCustomerAmount(bet.potential_return)}</strong></span>
          </div>
          <small className="customer-bet-date">Placed {new Date(bet.placed_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</small>
        </article>
      ))}
    </section>
  );
}
