"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, RefreshCw, Ticket, X, Share2, Copy, CheckCheck } from "lucide-react";
import { readBetSlip, writeBetSlip, serializeBetSlipForCode, deserializeBetSlipFromCode, type BetSlipSelection } from "@/lib/bet-slip";
import { currencySymbol, formatCustomerAmount } from "@/lib/currency";
import { minStake, minStakeLabel, normalizeCurrency } from "@/lib/limits";

type SportScoreMatch = {
  home?: string;
  away?: string;
  home_score?: number | null;
  away_score?: number | null;
  status?: string;
  status_text?: string;
  time?: string;
  slug?: string;
  competition?: string;
  odds?: string[];
  market_odds?: Record<string, Record<string, string>>;
  current_minute?: number | null;
  source?: string;
};

type LiveScoresProps = {
  sport: string;
  market: string;
};

type LiveScoresResponse = {
  matches?: SportScoreMatch[];
  updated?: string | null;
  sport?: string;
  error?: string;
  databaseReady?: boolean;
  setupRequired?: boolean;
};

function formatKickoff(value?: string) {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

const marketOptions: Record<string, string[]> = {
  "1X2": ["1", "X", "2"],
  "O/U": ["Over 2.5", "Under 2.5"],
  DC: ["1X", "12", "X2"],
  "1st Half O/U": ["Over 0.5", "Under 0.5"],
  Handicap: ["Home -1", "Away +1"],
  "Match Winner": ["Player 1", "Player 2"],
  "Set Betting": ["2-0", "2-1", "0-2", "1-2"],
  "Total Games": ["Over 22.5", "Under 22.5"],
  "Game Handicap": ["Player 1 -2.5", "Player 2 +2.5"],
  Moneyline: ["Home", "Away"],
  Totals: ["Over 180.5", "Under 180.5"],
  "1st Half": ["Home", "Draw", "Away"],
  "Total Sets": ["Over 3.5", "Under 3.5"]
};

const sportNames: Record<string, string> = {
  Football: "football",
  Tennis: "tennis",
  Basketball: "basketball",
  "Table Tennis": "table-tennis"
};

/**
 * Odds for a selection come from the API (generateAllMarketOdds) so every
 * surface shows the same prices. Falls back to a stable default only if
 * the API field is missing (e.g. cached old responses).
 */
function getOdds(match: SportScoreMatch, market: string, option: string): string {
  const fromMap = match.market_odds?.[market]?.[option];
  if (fromMap) return fromMap;
  // 1X2 fallback from the flat odds array.
  if (market === "1X2" && Array.isArray(match.odds)) {
    const idx = option === "1" ? 0 : option === "X" ? 1 : option === "2" ? 2 : -1;
    if (idx >= 0 && match.odds[idx]) return match.odds[idx];
  }
  // Last resort — mirrors the generator's centre price.
  return "1.90";
}

export default function LiveScores({ sport, market }: LiveScoresProps) {
  const [matches, setMatches] = useState<SportScoreMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [selectedBets, setSelectedBets] = useState<Record<string, BetSlipSelection>>({});
  const [stake, setStake] = useState("150");
  const slipHydrated = useRef(false);
  const [placing, setPlacing] = useState(false);
  const [betNotice, setBetNotice] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [setupRequired, setSetupRequired] = useState(false);
  // Bet slip bubble starts open on desktop (viewport doesn't hide it) and
  // collapsed on mobile; guests see it too — selection needs no account.
  const [slipOpen, setSlipOpen] = useState(false);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  // Currency of the signed-in wallet — drives the stake label and the
  // minimum-stake hint on the slip. Defaults to cedis for guests.
  const [walletCurrency, setWalletCurrency] = useState<string>("GHS");
  const [bookingCode, setBookingCode] = useState<string | null>(null);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [codeNotice, setCodeNotice] = useState("");

  const loadMatches = useCallback(async () => {
    const apiSport = sport === "LIVE" ? "football" : sportNames[sport] || "football";
    // LIVE tab asks the server for live-only matches. All other tabs load
    // the full feed and let the UI show them; finished matches are shown
    // with their final score but with betting disabled.
    const query = sport === "LIVE"
      ? `/api/sports/live?sport=${encodeURIComponent(apiSport)}&live=true`
      : `/api/sports/live?sport=${encodeURIComponent(apiSport)}`;
    try {
      const response = await fetch(query, { cache: "no-store" });
      const data: LiveScoresResponse = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load live scores.");
      const nextMatches = Array.isArray(data.matches) ? data.matches : [];
      const uniqueMatches = Array.from(new Map(nextMatches.map((match) => [match.slug || `${match.home}-${match.away}-${match.time}`, match])).values());
      setMatches(uniqueMatches);
      // Drop selections for matches that are now finished/cancelled — the
      // bet can no longer be placed.
      setSelectedBets((current) => Object.fromEntries(Object.entries(current).filter(([, selection]) => {
        const fixture = uniqueMatches.find((match) => match.slug === selection.matchId);
        return fixture && !/finished|full.?time|\bft\b|completed|ended|cancelled/i.test(fixture.status_text || fixture.status || "");
      })));
      setSetupRequired(data.setupRequired === true);
      setLastUpdated(data.updated ?? new Date().toISOString());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load live scores.");
    } finally {
      setLoading(false);
    }
  }, [sport]);

  useEffect(() => {
    const saved = readBetSlip();
    setSelectedBets(saved.selections);
    setStake(saved.stake);
  }, []);

  useEffect(() => {
    if (!slipHydrated.current) {
      slipHydrated.current = true;
      return;
    }
    writeBetSlip({ selections: selectedBets, stake });
  }, [selectedBets, stake]);

  // Dismiss the bet slip like a real popup: tap/click anywhere outside it,
  // or press Escape. Picking another odd is deliberately NOT treated as
  // "outside" — the slip stays put while the user keeps adding selections.
  useEffect(() => {
    if (!slipOpen) return;

    function isOutsideInteractive(target: HTMLElement | null) {
      if (!target) return false;
      if (target.closest(".betslip")) return false; // inside the slip
      // Odds chips, tab strips and sliders keep the slip open.
      return !target.closest(
        ".sportscore-odds, .odds-row, .live-odds, .league-tabs, .sport-tabs, .market-tabs, .featured-track, .promo-strip, .shortcut-row"
      );
    }

    function onOutside(event: MouseEvent | TouchEvent) {
      if (isOutsideInteractive(event.target as HTMLElement | null)) setSlipOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setSlipOpen(false);
    }

    document.addEventListener("mousedown", onOutside);
    document.addEventListener("touchstart", onOutside, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("touchstart", onOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [slipOpen]);

  useEffect(() => {
    fetch("/api/auth/customer", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) { setAuthenticated(false); return; }
        const value = await response.json() as { currency?: string | null } | null;
        setAuthenticated(true);
        if (value?.currency) {
          setWalletCurrency(value.currency);
          // Prefill the stake with the minimum for this wallet's currency so
          // the Place bet button is never disabled out of the box (GH₵150 for
          // cedi accounts, ₦15,000 for naira accounts).
          const minimum = minStake(value.currency);
          setStake((current) => (Number(current || 0) < minimum ? String(minimum) : current));
        }
      })
      .catch(() => setAuthenticated(false));
    // A returning winner who hasn't been greeted yet sees the trophy on the
    // homepage itself (not just on /account?nav=bets).
    const checkReturningWin = async () => {
      try {
        const response = await fetch("/api/bets", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json() as { settled?: Array<{ id: string; status: string; payout: number }>; bets?: Array<{ id: string; status: string; potential_return: number; stake: number }> };
        const celebrated = JSON.parse(window.localStorage.getItem("alphabet_celebrated_wins") || window.localStorage.getItem("betkiing_celebrated_wins") || "[]") as string[];
        const freshWins = (data.bets || []).filter((bet) => bet.status === "won" && !celebrated.includes(bet.id));
        if (freshWins.length) {
          // Persist so we don't greet again on refresh.
          window.localStorage.setItem("alphabet_celebrated_wins", JSON.stringify([...new Set([...celebrated, ...freshWins.map((b) => b.id)])]));
          // Import lazily to avoid a top-level cycle — WinCelebration is a leaf.
          const { default: WinCelebration } = await import("@/components/win-celebration");
          const overlay = document.createElement("div");
          overlay.id = "win-celebration-root";
          document.body.appendChild(overlay);
          const ReactDOM = await import("react-dom/client");
          const React = await import("react");
          const root = ReactDOM.createRoot(overlay);
          root.render(React.createElement(WinCelebration, {
            win: { id: freshWins[0].id, payout: freshWins[0].potential_return, stake: freshWins[0].stake, potential_return: freshWins[0].potential_return },
            onClose: () => { root.unmount(); overlay.remove(); }
          }));
        }
      } catch {
        // Non-fatal — the wins are also shown on /account?nav=bets.
      }
    };
    if (window.location.pathname === "/") void checkReturningWin();
  }, []);

  useEffect(() => {
    setLoading(true);
    setMatches([]);
    void loadMatches();
    const interval = window.setInterval(() => void loadMatches(), 15_000);
    return () => window.clearInterval(interval);
  }, [loadMatches]);

  // Finished and cancelled matches are NEVER shown on the customer site —
  // the API already filters them, this is a client-side safety net so a
  // stale cache can never leak a finished match into the UI.
  const visibleMatches = matches.filter((match) => {
    const raw = (match.status_text || match.status || "").trim().toLowerCase();
    return !(
      raw.includes("full time") ||
      raw === "finished" ||
      raw === "ft" ||
      raw === "completed" ||
      raw === "ended" ||
      raw.includes("cancelled") ||
      raw.includes("canceled")
    );
  });
  const options = marketOptions[market] || marketOptions["1X2"];
  const toggleBet = (key: string, match: SportScoreMatch, option: string, odds: string) => {
    // Anyone can select odds — the bet slip is a browsing tool. Sign-in is
    // only needed when placing the bet (enforced in placeBet below).
    setAuthNotice("");
    setSelectedBets((current) => {
      const next = { ...current };
      if (next[key]) delete next[key];
      else {
        next[key] = { match: `${match.home || "Home"} v ${match.away || "Away"}`, matchId: match.slug || key, option, odds, market };
        setSlipOpen(true);
      }
      return next;
    });
  };
  const betslipItems = Object.entries(selectedBets);
  const combinedOdds = betslipItems.reduce((total, [, bet]) => total * Number(bet.odds), 1);
  const potentialReturn = Number(stake || 0) * combinedOdds;

  // The slip shows every amount in the signed-in wallet's currency. Guests
  // (and cedi accounts) see GH₵; a naira account sees ₦ with the ₦15,000
  // floor instead of GH₵150.
  const slipCurrency = normalizeCurrency(walletCurrency);
  const stakeMinimum = minStake(slipCurrency);
  const stakeBelowMinimum = Number(stake || 0) < stakeMinimum;

  const placeBet = async () => {
    if (placing) return; // double-click guard — the button is disabled anyway
    setBetNotice("");
    // Client-side mirror of the server rule so the user isn't sent a
    // request we already know will be rejected.
    if (stakeBelowMinimum) {
      setBetNotice(minStakeLabel(slipCurrency) + ".");
      return;
    }
    setPlacing(true);
    try {
      const authResponse = await fetch("/api/auth/customer", { cache: "no-store" });
      if (!authResponse.ok) {
        setAuthenticated(false);
        setBetNotice("Sign in to place your bet.");
        window.setTimeout(() => window.location.assign("/login"), 700);
        return;
      }
      setAuthenticated(true);
      const response = await fetch("/api/bets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stake: Number(stake),
          selections: betslipItems.map(([, bet]) => ({ ...bet, odds: Number(bet.odds) }))
        })
      });
      const data = await response.json() as { error?: string; potentialReturn?: number };
      if (!response.ok) throw new Error(data.error || "The bet could not be placed.");
      setBetNotice(`Bet placed successfully. Potential return: ${formatCustomerAmount(Number(data.potentialReturn), slipCurrency)}`);
      setSelectedBets({});
    } catch (error) {
      setBetNotice(error instanceof Error ? error.message : "The bet could not be placed.");
    } finally {
      // Always re-enable — even if the request threw synchronously.
      setPlacing(false);
    }
  };

  const shareBetSlip = async () => {
    if (betslipItems.length === 0) {
      setCodeNotice("Add at least one selection before sharing.");
      return;
    }
    setGeneratingCode(true);
    setCodeNotice("");
    setCopied(false);
    try {
      const response = await fetch("/api/booking-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(serializeBetSlipForCode({ selections: selectedBets, stake }))
      });
      const data = await response.json() as { code?: string; error?: string };
      if (!response.ok) throw new Error(data.error || "Could not create a booking code.");
      setBookingCode(data.code || null);
    } catch (error) {
      setCodeNotice(error instanceof Error ? error.message : "Could not create a booking code.");
    } finally {
      setGeneratingCode(false);
    }
  };

  const copyBookingCode = async () => {
    if (!bookingCode) return;
    try {
      await navigator.clipboard.writeText(bookingCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCodeNotice("Could not copy — select the code and copy it manually.");
    }
  };

  return (
    <section className="sportscore-panel" aria-live="polite">
      <div className="sportscore-heading">
        <div>
          <h2><span className="sportscore-live-indicator" /> {sport === "LIVE" ? "LIVE NOW" : sport.toUpperCase()} <em>{matches.length}</em></h2>
          <p>{sport === "LIVE" ? "In-play football and markets" : `${sport} scores and markets`} from SportScore · {market}</p>
        </div>
        <button className="sportscore-refresh" onClick={() => { setLoading(true); void loadMatches(); }} aria-label="Refresh scores">
          <RefreshCw size={16} />
        </button>
      </div>

      {loading && <div className="sportscore-message">Loading {sport === "LIVE" ? "live football" : sport.toLowerCase()} matches…</div>}
      {!loading && !error && setupRequired && <div className="sportscore-setup-notice">Live matches are available, but the AlphaBet database is not set up yet. An admin should run the Supabase schema before creating matches or placing bets.</div>}
      {!loading && error && (
        <div className="sportscore-message sportscore-error">
          <span>{error}</span>
          <button onClick={() => { setLoading(true); void loadMatches(); }}>Try again</button>
        </div>
      )}
      {!loading && !error && visibleMatches.length === 0 && (
        <div className="sportscore-message">
          <Ticket size={22} />
          <span>{sport === "LIVE" ? "No games are live right now. Explore upcoming football markets." : `No ${sport.toLowerCase()} matches are available right now. Check back later.`}</span>
        </div>
      )}

      {!loading && !error && visibleMatches.map((match, index) => {
        // Match the SportScore wording exactly — "Live", "Full time",
        // "Upcoming", "Cancelled" — for every source, including manual ones.
        const rawStatus = (match.status_text || match.status || "scheduled").trim().toLowerCase();
        const normalized = rawStatus.includes("full time") || rawStatus === "finished" || rawStatus === "ft" || rawStatus === "completed" || rawStatus === "ended"
          ? "finished"
          : rawStatus.includes("cancelled") || rawStatus.includes("canceled")
            ? "cancelled"
            : rawStatus.includes("live") || rawStatus.includes("in play") || rawStatus.includes("1st half") || rawStatus.includes("2nd half") || rawStatus.includes("half time")
              ? "live"
              : "scheduled";
        const statusLabel = normalized === "finished" ? "Full time" : normalized === "cancelled" ? "Cancelled" : normalized === "live" ? (match.status_text && /^\d/.test(match.status_text) ? match.status_text : "Live") : "Upcoming";
        const isLive = normalized === "live";
        const isFinished = normalized === "finished" || normalized === "cancelled";
        const hasScore = typeof match.home_score === "number" && typeof match.away_score === "number";
        const matchKey = match.slug || `${match.home}-${match.away}-${index}`;
        return (
          <article className="sportscore-match" key={matchKey}>
            <div className="sportscore-match-meta">
              <span className={isLive ? "sportscore-status is-live" : "sportscore-status"}>
                {isLive && <i />}{statusLabel}
              </span>
              <span>{match.competition || sport}</span>
              <time>{formatKickoff(match.time)}</time>
            </div>
            <div className="sportscore-match-teams">
              <div className="sportscore-team-names">
                <strong>{match.home || "Home team"}</strong>
                <strong>{match.away || "Away team"}</strong>
              </div>
              <div className="sportscore-score" aria-label={hasScore ? `${match.home_score} to ${match.away_score}` : "Score not available"}>
                {hasScore ? <><span>{match.home_score}</span><span>:</span><span>{match.away_score}</span></> : <span>—</span>}
              </div>
            </div>
            <div className={`sportscore-odds ${isFinished ? "is-disabled" : ""}`}>
              {options.map((option) => {
                const betKey = `${matchKey}-${market}-${option}`;
                const selected = Boolean(selectedBets[betKey]);
                const odds = getOdds(match, market, option);
                return (
                  <button key={option} disabled={isFinished} className={selected ? "is-selected" : ""} onClick={() => toggleBet(betKey, match, option, odds)}>
                    <span>{option}</span>
                    <strong>{selected ? <Check size={14} /> : odds}</strong>
                  </button>
                );
              })}
            </div>
          </article>
        );
      })}
      {authNotice && <div className="sportscore-auth-notice">{authNotice}</div>}
      {/* Bet slip is always available — guests can build a slip with no
          account. Sign-in is enforced when they tap "Place bet". */}
      {authenticated !== null && (
        <aside className={`betslip ${slipOpen ? "is-open" : "is-collapsed"}`}>
          {!slipOpen && (
            <button className="betslip-bubble" onClick={() => setSlipOpen(true)} aria-label={`Open bet slip with ${betslipItems.length} selection${betslipItems.length === 1 ? "" : "s"}`}>
              <Ticket size={22} />
              <b>{betslipItems.length}</b>
            </button>
          )}
          {slipOpen && <>
          <div className="betslip-heading">
            <span><Ticket size={18} /> BET SLIP <b>{betslipItems.length}</b></span>
            <button className="betslip-collapse" onClick={() => setSlipOpen(false)} aria-label="Minimize bet slip">−</button>
            <button onClick={() => setSlipOpen(false)} aria-label="Close bet slip"><X size={16} /></button>
          </div>
          <div className="betslip-selections">
            {betslipItems.map(([key, bet]) => (
              <div className="betslip-selection" key={key}>
                <span><strong>{bet.option} @ {bet.odds}</strong><small>{bet.match}</small></span>
                <button onClick={() => setSelectedBets((current) => { const next = { ...current }; delete next[key]; return next; })} aria-label={`Remove ${bet.match}`}><X size={14} /></button>
              </div>
            ))}
            {betslipItems.length === 0 && <p className="betslip-empty">Your bet slip is empty. Select an odd to add it here.</p>}
          </div>
          {betslipItems.length > 0 && (
            <button type="button" className="betslip-clear" onClick={() => setSelectedBets({})}>Clear all selections</button>
          )}
          <label className="betslip-stake">Stake ({currencySymbol(slipCurrency)})<input type="number" min={stakeMinimum} step="0.01" inputMode="decimal" value={stake} onChange={(event) => setStake(event.target.value)} aria-label={`Stake in ${slipCurrency}`} /></label>
          {/* Minimum stake is always visible above the action button so the
              user knows the floor before tapping "Place bet". */}
          <p className={`betslip-min-stake ${stakeBelowMinimum ? "is-below" : ""}`}>
            {stakeBelowMinimum ? `Minimum stake is ${formatCustomerAmount(stakeMinimum, slipCurrency)} — enter at least that amount.` : `${minStakeLabel(slipCurrency)}`}
          </p>
          <div className="betslip-footer"><span>Potential return <small>{betslipItems.length} selection{betslipItems.length === 1 ? "" : "s"}</small></span><strong>{formatCustomerAmount(potentialReturn, slipCurrency)}</strong></div>
          <div className="betslip-booking-code">
            <div className="betslip-booking-code-head">
              <Share2 size={13} />
              <span>Share this slip</span>
            </div>
            <button type="button" className="booking-code-button" onClick={() => void shareBetSlip()} disabled={generatingCode || betslipItems.length === 0}>
              {generatingCode ? "Generating code…" : bookingCode ? "Regenerate code" : "Get booking code"}
            </button>
            {bookingCode && (
              <div className="booking-code-display">
                <div className="booking-code-display-top">
                  <code>{bookingCode.slice(0, 2)} {bookingCode.slice(2)}</code>
                  <button type="button" onClick={() => void copyBookingCode()} aria-label="Copy booking code">
                    {copied ? <CheckCheck size={14} /> : <Copy size={14} />}
                  </button>
                </div>
                <small>{copied ? "Copied — paste it anywhere" : "Expires in 7 days · anyone with the code can load this slip"}</small>
              </div>
            )}
            {codeNotice && <p className="betslip-notice">{codeNotice}</p>}
            <div className="betslip-load-code-row">
              <span>Got a code from a friend?</span>
              <a href="/load-code" className="load-code-link">Load it →</a>
            </div>
          </div>
          <a href="/load-code" className="load-code-link">Have a booking code? Load it →</a>
          {betNotice && <p className="betslip-notice">{betNotice}</p>}
          <button className="place-bet-button" onClick={() => void placeBet()} disabled={placing || betslipItems.length === 0 || !stake || Number(stake) <= 0 || stakeBelowMinimum}>{placing ? "Placing bet..." : stakeBelowMinimum ? `Min stake ${formatCustomerAmount(stakeMinimum, slipCurrency)}` : "Place bet"}</button>
          </>}
        </aside>
      )}
      <div className="sportscore-attribution">
        {lastUpdated && <span>Updated {new Date(lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
        <a href="https://sportscore.com/" rel="dofollow" target="_blank">Powered by SportScore</a>
      </div>
    </section>
  );
}
