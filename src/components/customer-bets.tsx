"use client";

import { useEffect, useState } from "react";
import { Clock3, History, RefreshCw, Ticket, Check, X, Hourglass, ChevronRight, Trophy } from "lucide-react";
import WinCelebration, { type WinCelebrationBet } from "@/components/win-celebration";
import { currencySymbol } from "@/lib/currency";

type CustomerBet = {
  id: string;
  stake: number;
  potential_return: number;
  status: string;
  selections: Array<{ match?: string; matchId?: string; option?: string; odds?: number; market?: string; stake?: number }>;
  placed_at: string;
};

type SettledBet = { id: string; status: string; payout: number; stake: number; potential_return: number };

type LegOutcome = "won" | "lost" | "pending";
type LegState = { outcome: LegOutcome; home?: number | null; away?: number | null; statusText?: string };
type FixtureInfo = { home_score?: number | null; away_score?: number | null; status?: string; status_text?: string; current_minute?: number | null };

function fixtureStatus(fixture: FixtureInfo): "finished" | "cancelled" | "live" | "scheduled" {
  const raw = (fixture.status_text || fixture.status || "").trim().toLowerCase();
  if (raw.includes("full time") || raw === "finished" || raw === "ft" || raw === "completed" || raw === "ended") return "finished";
  if (raw.includes("cancelled") || raw.includes("canceled")) return "cancelled";
  if (raw.includes("live") || raw.includes("in play") || raw.includes("1st half") || raw.includes("2nd half") || raw.includes("half time")) return "live";
  return "scheduled";
}

/**
 * Leg outcomes for the expanded card. Straightforward markets are graded
 * locally from the final score; anything else stays "running" rather than
 * claiming a result the server has not given.
 */
async function fetchLegStates(bets: CustomerBet[]): Promise<Record<string, LegState[]>> {
  const ids = [...new Set(bets.flatMap((bet) => (bet.selections || []).map((selection) => selection.matchId || "").filter(Boolean)))];
  if (ids.length === 0) return {};
  const response = await fetch(`/api/sports/live?matchIds=${encodeURIComponent(ids.join(","))}`, { cache: "no-store" });
  if (!response.ok) return {};
  const data = await response.json() as { matches?: Array<FixtureInfo & { slug?: string }> };
  const byId: Record<string, FixtureInfo> = {};
  for (const match of data.matches || []) {
    if (match.slug) byId[match.slug] = match;
  }
  const out: Record<string, LegState[]> = {};
  for (const bet of bets) {
    out[bet.id] = (bet.selections || []).map((selection) => {
      const fixture = byId[selection.matchId || ""];
      let outcome = gradeSelection(selection, fixture);
      // Settled bets already have a server verdict — a won bet means every
      // leg landed, so tick them all when the local grader can't read them.
      if (outcome === "pending" && bet.status === "won") outcome = "won";
      return {
        outcome,
        home: typeof fixture?.home_score === "number" ? fixture.home_score : null,
        away: typeof fixture?.away_score === "number" ? fixture.away_score : null,
        statusText: fixture?.status_text
      };
    });
  }
  return out;
}

function gradeSelection(selection: CustomerBet["selections"][number], fixture: FixtureInfo | undefined): LegOutcome {
  if (!fixture) return "pending";
  const status = fixtureStatus(fixture);
  if (status !== "finished" && status !== "cancelled") return "pending";
  if (status === "cancelled") return "pending"; // void = stake returned
  const home = Number(fixture.home_score ?? 0);
  const away = Number(fixture.away_score ?? 0);
  const total = home + away;
  const option = (selection.option || "").trim();
  const optionLower = option.toLowerCase();
  const market = (selection.market || "").trim().toLowerCase();
  const thresholdMatch = option.match(/(\d+(?:\.\d+)?)/);
  const threshold = thresholdMatch ? Number(thresholdMatch[1]) : null;
  const over = (value: number): LegOutcome => (threshold === null ? "pending" : value > threshold ? "won" : "lost");
  const under = (value: number): LegOutcome => (threshold === null ? "pending" : value < threshold ? "won" : "lost");

  switch (market) {
    case "1x2":
      return option === "1" ? (home > away ? "won" : "lost") : option === "2" ? (away > home ? "won" : "lost") : home === away ? "won" : "lost";
    case "dc":
      return optionLower === "1x" ? (home >= away ? "won" : "lost") : optionLower === "x2" ? (away >= home ? "won" : "lost") : home !== away ? "won" : "lost";
    case "o/u":
    case "totals":
    case "total sets":
      return optionLower.startsWith("over") ? over(total) : under(total);
    case "handicap":
    case "game handicap": {
      const parsed = option.match(/^(home|away|player\s*1|player\s*2)\s*([+-]\d+(?:\.\d+)?)$/i);
      if (!parsed) return "pending";
      const line = Number(parsed[2]);
      const named = /home|player\s*1/i.test(parsed[1]);
      const adjustedNamed = (named ? home : away) + line;
      const adjustedOther = named ? away : home;
      if (Math.abs(adjustedNamed - adjustedOther) < 0.001) return "pending";
      return adjustedNamed > adjustedOther ? "won" : "lost";
    }
    case "match winner":
      return optionLower.includes("1") || optionLower.includes("p1") ? (home > away ? "won" : "lost") : away > home ? "won" : "lost";
    case "moneyline":
      return optionLower === "home" || optionLower === "player 1" ? (home > away ? "won" : "lost") : away > home ? "won" : "lost";
    case "correct score": {
      const inGrid = home <= 4 && away <= 4;
      const exact = option.match(/^(\d+)\s*-\s*(\d+)$/);
      if (exact) return home === Number(exact[1]) && away === Number(exact[2]) ? "won" : "lost";
      if (optionLower === "any other home win") return !inGrid && home > away ? "won" : "lost";
      if (optionLower === "any other away win") return !inGrid && away > home ? "won" : "lost";
      if (optionLower === "any other draw") return !inGrid && home === away ? "won" : "lost";
      return "pending";
    }
    case "set betting": {
      const parsed = option.match(/^(\d+)\s*-\s*(\d+)$/);
      if (!parsed) return "pending";
      return home === Number(parsed[1]) && away === Number(parsed[2]) ? "won" : "lost";
    }
    // First-half markets need half-time data the final score does not carry.
    default:
      return "pending";
  }
}

// A win is celebrated once per browser, no matter which request settled it.
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

export default function CustomerBets({ initialTab = "active" }: { initialTab?: "active" | "history" }) {
  const [tab, setTab] = useState(initialTab);
  const [bets, setBets] = useState<CustomerBet[]>([]);
  const [currency, setCurrency] = useState("GHS");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [wins, setWins] = useState<WinCelebrationBet[]>([]);
  // Collapsible cards — collapsed by default, one open at a time.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [legStates, setLegStates] = useState<Record<string, LegState[]>>({});

  const money = (value: number) => `${currencySymbol(currency)} ${Number(value || 0).toFixed(2)}`;

  async function loadBets(options?: { quiet?: boolean }) {
    if (!options?.quiet) setLoading(true);
    try {
      const response = await fetch("/api/bets", { cache: "no-store" });
      const data = await response.json() as { bets?: CustomerBet[]; settled?: SettledBet[]; currency?: string; error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to load bets.");
      setBets(data.bets || []);
      if (data.currency) setCurrency(data.currency);
      const settled = data.settled || [];
      const celebrated = readCelebratedWins();
      const betsById = new Map((data.bets || []).map((bet) => [bet.id, bet]));
      const fresh: WinCelebrationBet[] = [
        // Exact payout when this very request settled the bet …
        ...settled
          .filter((bet) => bet.status === "won" && !celebrated.includes(bet.id))
          .map((bet) => ({ id: bet.id, payout: bet.payout, stake: bet.stake, potential_return: bet.potential_return, selections: betsById.get(bet.id)?.selections })),
        // … otherwise a win that landed earlier still deserves its moment.
        ...(data.bets || [])
          .filter((bet) => bet.status === "won" && !celebrated.includes(bet.id) && !settled.some((s) => s.id === bet.id))
          .map((bet) => ({ id: bet.id, payout: bet.potential_return, stake: bet.stake, potential_return: bet.potential_return, selections: bet.selections }))
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
      if (!options?.quiet) setLoading(false);
    }
  }

  useEffect(() => {
    void loadBets();
    // Settlement can finish a bet while the page is open — poll quietly so it
    // moves from Active Bets into Bet History without a refresh.
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadBets({ quiet: true });
    }, 20000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (bets.length === 0) return;
    let cancelled = false;
    void fetchLegStates(bets).then((states) => {
      if (!cancelled) setLegStates(states);
    });
    return () => { cancelled = true; };
  }, [bets]);

  const activeBets = bets.filter((bet) => bet.status === "open");
  const displayedBets = tab === "active" ? activeBets : bets.filter((bet) => bet.status !== "open");

  const toggleCard = (id: string) => setExpandedId((current) => (current === id ? null : id));

  const switchTab = (next: "active" | "history") => {
    setTab(next);
    setExpandedId(null); // a card from the other tab must not pop open here
  };

  const renderBetCard = (bet: CustomerBet) => {
    const expanded = expandedId === bet.id;
    const legs = legStates[bet.id] || [];
    const selections = bet.selections || [];
    const isMulti = selections.length > 1;
    const comboOdds = selections.reduce((total, selection) => total * (Number(selection.odds || 1) || 1), 1);
    const payout = bet.status === "won" ? bet.potential_return : 0;
    return (
      <article className={`customer-bet-card is-${bet.status} ${expanded ? "is-expanded" : ""}`} key={bet.id}>
        <button
          type="button"
          className="customer-bet-card-heading"
          onClick={() => toggleCard(bet.id)}
          aria-expanded={expanded}
          aria-label={`${isMulti ? "Multiple" : "Single"} bet ${bet.id.slice(0, 8).toUpperCase()}, ${bet.status}`}
        >
          <span className="customer-bet-card-title">
            <span className="customer-bet-kind">{isMulti ? `Multiple · ${selections.length}` : "Single"}</span>
            <span className="customer-bet-id">{bet.id.slice(0, 8).toUpperCase()}</span>
          </span>
          <strong className={`bet-status bet-status-${bet.status}`}>{bet.status}</strong>
          <span className="customer-bet-chevron" aria-hidden="true"><ChevronRight size={16} /></span>
        </button>

        <div
          className="customer-bet-preview"
          role="button"
          tabIndex={0}
          onClick={() => toggleCard(bet.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              toggleCard(bet.id);
            }
          }}
          aria-label="Show bet details"
        >
          {selections.slice(0, 2).map((selection, index) => (
            <small key={`${bet.id}-preview-${index}`}>
              {selection.option || "Selection"} @ {Number(selection.odds || 0).toFixed(2)} · {selection.match || "Match"}
            </small>
          ))}
          {isMulti && selections.length > 2 && <small>+{selections.length - 2} more</small>}
        </div>

        {expanded && (
          <div className="customer-bet-details">
            <div className="customer-bet-selections">
              {selections.map((selection, index) => {
                const state = legs[index];
                const outcome = state?.outcome || "pending";
                const hasScore = typeof state?.home === "number" && typeof state?.away === "number";
                return (
                  <div className={`customer-bet-selection leg-${outcome}`} key={`${bet.id}-${index}`}>
                    <strong>{selection.option || "Selection"} <em>@ {Number(selection.odds || 0).toFixed(2)}</em></strong>
                    <small>{selection.match || "Match"} · {selection.market || "Market"}</small>
                    <div className="leg-meta">
                      <span className={`leg-state leg-state-${outcome}`}>
                        {outcome === "won" ? <Check size={12} /> : outcome === "lost" ? <X size={12} /> : <Hourglass size={12} />}
                        {outcome === "won" ? "won" : outcome === "lost" ? "lost" : "running"}
                      </span>
                      {hasScore && (
                        <span className={`leg-score ${outcome === "pending" ? "is-live" : ""}`}>
                          {state?.home} - {state?.away}
                          {outcome !== "pending" ? <em>FT</em> : <em>{state?.statusText || "live"}</em>}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="customer-bet-summary">
              <span>Stake <strong>{money(bet.stake)}</strong></span>
              <span>{isMulti ? "Combined odds" : "Odds"} <strong>{isMulti ? comboOdds.toFixed(2) : Number(selections[0]?.odds || 0).toFixed(2)}</strong></span>
              <span>{bet.status === "won" ? "Won" : bet.status === "lost" ? "Lost" : bet.status === "void" ? "Refund" : "Potential return"} <strong>{money(payout)}</strong></span>
            </div>
            {bet.status === "won" && (
              <p className="customer-bet-win"><Trophy size={13} /> You won this bet — winnings credited to your wallet.</p>
            )}
            {bet.status === "lost" && (
              <p className="customer-bet-loss"><X size={13} /> This bet lost — one or more selections did not win.</p>
            )}
            <small className="customer-bet-date">{new Date(bet.placed_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</small>
          </div>
        )}
      </article>
    );
  };

  return (
    <section className="customer-bets">
      <div className="customer-bets-tabs">
        <button className={tab === "active" ? "active" : ""} onClick={() => switchTab("active")}><Clock3 size={16} /> Active Bets <b>{activeBets.length}</b></button>
        <button className={tab === "history" ? "active" : ""} onClick={() => switchTab("history")}><History size={16} /> Bet History <b>{bets.length - activeBets.length}</b></button>
        <button className="customer-bets-refresh" onClick={() => void loadBets()} aria-label="Refresh bets"><RefreshCw size={15} /></button>
      </div>
      {loading && <div className="customer-bets-empty">Loading your bets...</div>}
      {!loading && error && <div className="customer-bets-empty customer-bets-error">{error}<button onClick={() => void loadBets()}>Try again</button></div>}
      {!loading && !error && displayedBets.length === 0 && <div className="customer-bets-empty"><Ticket size={27} /><strong>{tab === "active" ? "No active bets" : "No bet history yet"}</strong><span>{tab === "active" ? "Your currently open bets will appear here." : "Settled bets will appear here after your selections are decided."}</span></div>}
      {!loading && !error && displayedBets.map((bet) => renderBetCard(bet))}
      {wins.length > 0 && <WinCelebration win={wins[0]} onClose={() => setWins((current) => current.slice(1))} currency={currency} />}
    </section>
  );
}
