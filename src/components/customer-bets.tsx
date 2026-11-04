"use client";

import { useEffect, useState } from "react";
import { Clock3, History, RefreshCw, Ticket } from "lucide-react";
import WinCelebration, { type WinCelebrationBet } from "@/components/win-celebration";

type CustomerBet = {
  id: string;
  stake: number;
  potential_return: number;
  status: string;
  selections: Array<{ match?: string; option?: string; odds?: number; market?: string }>;
  placed_at: string;
};

type SettledBet = { id: string; status: string; payout: number; stake: number; potential_return: number };

// A win is celebrated once per browser, no matter which request settled it
// (this page, the live-scores poll, or a refresh on another screen).
const CELEBRATED_WINS_KEY = "alphabet_celebrated_wins";
const LEGACY_CELEBRATED_WINS_KEY = "betkiing_celebrated_wins";

function readCelebratedWins(): string[] {
  try {
    const raw = window.localStorage.getItem(CELEBRATED_WINS_KEY) || window.localStorage.getItem(LEGACY_CELEBRATED_WINS_KEY) || "[]";
    const stored = JSON.parse(raw);
    return Array.isArray(stored) ? stored.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function celebrateOnce(ids: string[]) {
  try {
    window.localStorage.setItem(CELEBRATED_WINS_KEY, JSON.stringify([...new Set([...readCelebratedWins(), ...ids])]));
  } catch {
    // Storage unavailable — the pop-up simply shows again next time.
  }
}

function money(value: number) {
  return `GH₵ ${Number(value || 0).toFixed(2)}`;
}

function BetCard({ bet }: { bet: CustomerBet }) {
  return (
    <article className="customer-bet-card">
      <div className="customer-bet-card-heading">
        <span><Ticket size={16} /> Bet {bet.id.slice(0, 8).toUpperCase()}</span>
        <strong className={`bet-status bet-status-${bet.status}`}>{bet.status}</strong>
      </div>
      <div className="customer-bet-selections">
        {bet.selections.map((selection, index) => (
          <div className="customer-bet-selection" key={`${bet.id}-${index}`}>
            <strong>{selection.option || "Selection"} <em>@ {Number(selection.odds || 0).toFixed(2)}</em></strong>
            <small>{selection.match || "Match"} · {selection.market || "Market"}</small>
          </div>
        ))}
      </div>
      <div className="customer-bet-summary">
        <span>Stake <strong>{money(bet.stake)}</strong></span>
        <span>Potential return <strong>{money(bet.potential_return)}</strong></span>
      </div>
      <small className="customer-bet-date">{new Date(bet.placed_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</small>
    </article>
  );
}

export default function CustomerBets({ initialTab = "active" }: { initialTab?: "active" | "history" }) {
  const [tab, setTab] = useState(initialTab);
  const [bets, setBets] = useState<CustomerBet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [wins, setWins] = useState<WinCelebrationBet[]>([]);

  async function loadBets() {
    setLoading(true);
    try {
      const response = await fetch("/api/bets", { cache: "no-store" });
      const data = await response.json() as { bets?: CustomerBet[]; settled?: SettledBet[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to load bets.");
      setBets(data.bets || []);
      const settled = data.settled || [];
      const celebrated = readCelebratedWins();
      const fresh: WinCelebrationBet[] = [
        // Exact payout when this very request settled the bet …
        ...settled
          .filter((bet) => bet.status === "won" && !celebrated.includes(bet.id))
          .map((bet) => ({ id: bet.id, payout: bet.payout, stake: bet.stake, potential_return: bet.potential_return })),
        // … otherwise a win that landed earlier still deserves its moment.
        ...(data.bets || [])
          .filter((bet) => bet.status === "won" && !celebrated.includes(bet.id) && !settled.some((s) => s.id === bet.id))
          .map((bet) => ({ id: bet.id, payout: bet.potential_return, stake: bet.stake, potential_return: bet.potential_return }))
      ];
      if (fresh.length) {
        celebrateOnce(fresh.map((bet) => bet.id));
        setWins((current) => [...current, ...fresh]);
      }
      if (settled.some((bet) => bet.payout > 0)) {
        window.dispatchEvent(new Event("alphabet:balance-updated"));
        window.dispatchEvent(new Event("betkiing:balance-updated")); // winnings just hit the wallet
      }
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load bets.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadBets(); }, []);

  const activeBets = bets.filter((bet) => bet.status === "open");
  const displayedBets = tab === "active" ? activeBets : bets.filter((bet) => bet.status !== "open");

  return (
    <section className="customer-bets">
      <div className="customer-bets-tabs">
        <button className={tab === "active" ? "active" : ""} onClick={() => setTab("active")}><Clock3 size={16} /> Active Bets <b>{activeBets.length}</b></button>
        <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}><History size={16} /> Bet History <b>{bets.length - activeBets.length}</b></button>
        <button className="customer-bets-refresh" onClick={() => void loadBets()} aria-label="Refresh bets"><RefreshCw size={15} /></button>
      </div>
      {loading && <div className="customer-bets-empty">Loading your bets...</div>}
      {!loading && error && <div className="customer-bets-empty customer-bets-error">{error}<button onClick={() => void loadBets()}>Try again</button></div>}
      {!loading && !error && displayedBets.length === 0 && <div className="customer-bets-empty"><Ticket size={27} /><strong>{tab === "active" ? "No active bets" : "No bet history yet"}</strong><span>{tab === "active" ? "Your currently open bets will appear here." : "Settled bets will appear here after your selections are decided."}</span></div>}
      {!loading && !error && displayedBets.map((bet) => <BetCard key={bet.id} bet={bet} />)}
      {wins.length > 0 && <WinCelebration win={wins[0]} onClose={() => setWins((current) => current.slice(1))} />}
    </section>
  );
}
