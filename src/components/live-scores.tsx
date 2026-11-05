"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, RefreshCw, Ticket, X, Share2, Copy, CheckCheck } from "lucide-react";
import { readBetSlip, writeBetSlip, serializeBetSlipForCode, deserializeBetSlipFromCode, normalizeBookingCode, isValidBookingCode, formatBookingCode, CODE_LENGTH, type BetSlipSelection, type BetSlipMode } from "@/lib/bet-slip";
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
  "Total Sets": ["Over 3.5", "Under 3.5"],
  // Football-only: exact scorelines 0–4 x 0–4 plus "any other" buckets.
  "Correct Score": [
    "0-0", "0-1", "0-2", "0-3", "0-4",
    "1-0", "1-1", "1-2", "1-3", "1-4",
    "2-0", "2-1", "2-2", "2-3", "2-4",
    "3-0", "3-1", "3-2", "3-3", "3-4",
    "4-0", "4-1", "4-2", "4-3", "4-4",
    "Any other home win", "Any other draw", "Any other away win"
  ]
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
  // "multiple" = one stake on the whole accumulator. "singles" = every game
  // gets its own stake and is placed as its own bet, like a real sportsbook.
  const [slipMode, setSlipMode] = useState<BetSlipMode>("multiple");
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
  const [codeChars, setCodeChars] = useState<string[]>(Array(CODE_LENGTH).fill(""));
  const [loadingCode, setLoadingCode] = useState(false);
  const codeInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const codeValue = codeChars.join("");

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
    setSlipMode(saved.mode || "multiple");

    // Booking codes are loaded inside the slip — a shared link like
    // /?code=X7K2P auto-loads that slip here, SportyBet style.
    const shared = new URLSearchParams(window.location.search).get("code");
    if (shared) {
      const normalized = normalizeBookingCode(shared).split("").slice(0, CODE_LENGTH);
      setCodeChars([...normalized, ...Array(CODE_LENGTH - normalized.length).fill("")]);
      setSlipOpen(true);
    }
  }, []);

  // Paste a booking code anywhere on the page (SportyBet style).
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const pasted = event.clipboardData?.getData("text") || "";
      if (pasted && isValidBookingCode(pasted)) {
        event.preventDefault();
        fillCodeBoxes(pasted);
        setSlipOpen(true);
      }
    };
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, []);

  useEffect(() => {
    if (!slipHydrated.current) {
      slipHydrated.current = true;
      return;
    }
    writeBetSlip({ selections: selectedBets, stake, mode: slipMode });
  }, [selectedBets, stake, slipMode]);

  // Dismiss the bet slip like a real popup: tap/click anywhere outside it,
  // or press Escape. Picking another odd is deliberately NOT treated as
  // "outside" — the slip stays put while the user keeps adding selections.
  useEffect(() => {
    if (!slipOpen) return;

    function isOutsideInteractive(target: HTMLElement | null) {
      if (!target) return false;
      if (target.closest(".betslip")) return false; // inside the slip
      // The backdrop closes itself via its own onClick. Handled here too it
      // would unmount on touchstart and the follow-up click could land on an
      // odd behind it, silently adding a selection (ghost click).
      if (target.closest(".betslip-backdrop")) return false;
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
  // Selecting an odd never opens the slip by itself — it only updates the
  // floating bubble count. The sheet opens exclusively when the user taps
  // the bubble (SportyBet style).
  const toggleBet = (key: string, match: SportScoreMatch, option: string, odds: string) => {
    setAuthNotice("");
    setSelectedBets((current) => {
      const next = { ...current };
      if (next[key]) delete next[key];
      else {
        // In Singles mode a newly picked game already has its own stake box
        // pre-filled with the minimum, so the slip is placeable immediately.
        const defaultStake = slipMode === "singles" ? String(minStake(normalizeCurrency(walletCurrency))) : undefined;
        next[key] = { match: `${match.home || "Home"} v ${match.away || "Away"}`, matchId: match.slug || key, option, odds, market, stake: defaultStake };
        // NOTE: no setSlipOpen(true) here — the slip stays put.
      }
      return next;
    });
  };

  const betslipItems = Object.entries(selectedBets);
  const combinedOdds = betslipItems.reduce((total, [, bet]) => total * Number(bet.odds), 1);

  // The slip shows every amount in the signed-in wallet's currency. Guests
  // (and cedi accounts) see GH₵; a naira account sees ₦ with the ₦15,000
  // floor instead of GH₵150.
  const slipCurrency = normalizeCurrency(walletCurrency);
  const stakeMinimum = minStake(slipCurrency);
  const isSingles = slipMode === "singles";

  // Multiple: one stake covers the whole accumulator.
  // Singles: every game carries its own stake — total staked is the sum,
  // and the return is each game's stake x its odds added together.
  const singlesStakes = betslipItems.map(([, bet]) => Number(bet.stake || 0));
  const totalStake = isSingles ? singlesStakes.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0) : Number(stake || 0);
  const potentialReturn = isSingles
    ? betslipItems.reduce((total, [, bet]) => total + (Number(bet.stake) || 0) * Number(bet.odds), 0)
    : Number(stake || 0) * combinedOdds;
  const stakeBelowMinimum = isSingles
    ? singlesStakes.some((value) => !Number.isFinite(value) || value <= 0) || totalStake < stakeMinimum
    : Number(stake || 0) < stakeMinimum;

  const placeBet = async () => {
    if (placing) return; // double-click guard — the button is disabled anyway
    setBetNotice("");
    // Client-side mirror of the server rule so the user isn't sent a
    // request we already know will be rejected.
    if (stakeBelowMinimum) {
      setBetNotice(isSingles ? `Your single stakes must add up to at least ${formatCustomerAmount(stakeMinimum, slipCurrency)}.` : minStakeLabel(slipCurrency) + ".");
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
          mode: slipMode,
          stake: isSingles ? totalStake : Number(stake),
          selections: betslipItems.map(([, bet]) => ({
            ...bet,
            odds: Number(bet.odds),
            ...(isSingles ? { stake: Number(bet.stake) } : {})
          }))
        })
      });
      const data = await response.json() as { error?: string; potentialReturn?: number; count?: number };
      if (!response.ok) throw new Error(data.error || "The bet could not be placed.");
      setBetNotice(isSingles && data.count && data.count > 1
        ? `Placed ${data.count} single bets. Total potential return: ${formatCustomerAmount(Number(data.potentialReturn), slipCurrency)}`
        : `Bet placed successfully. Potential return: ${formatCustomerAmount(Number(data.potentialReturn), slipCurrency)}`);
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

  function fillCodeBoxes(text: string) {
    const chars = normalizeBookingCode(text).split("").slice(0, CODE_LENGTH);
    setCodeChars([...chars, ...Array(CODE_LENGTH - chars.length).fill("")]);
  }

  async function loadBookingCode() {
    const code = normalizeBookingCode(codeValue);
    if (!isValidBookingCode(code)) {
      setCodeNotice(`Enter a valid ${CODE_LENGTH}-character booking code (e.g. X7K2P).`);
      return;
    }
    setLoadingCode(true);
    setCodeNotice("");
    try {
      const response = await fetch(`/api/booking-codes?code=${encodeURIComponent(code)}`, { cache: "no-store" });
      const data = await response.json() as { selections?: BetSlipSelection[]; stake?: string; error?: string };
      if (!response.ok) throw new Error(data.error || "Could not load this booking code.");
      const state = deserializeBetSlipFromCode({
        selections: (data.selections || []).map((sel) => ({ ...sel, odds: String(sel.odds) })),
        stake: data.stake || "150"
      });
      setSelectedBets(state.selections);
      setStake(state.stake);
      setSlipMode(state.mode || "multiple");
      setCodeNotice(`Loaded ${Object.keys(state.selections).length} selection${Object.keys(state.selections).length === 1 ? "" : "s"} from ${formatBookingCode(code)}.`);
      // Toast-free, SportyBet-style: the slip just reflects the loaded state.
      setCodeChars(Array(CODE_LENGTH).fill(""));
    } catch (error) {
      setCodeNotice(error instanceof Error ? error.message : "Could not load this booking code.");
    } finally {
      setLoadingCode(false);
    }
  }

  function handleCodeCharChange(index: number, value: string) {
    // Pasting all 5 chars into one box spreads across the boxes.
    if (value.length > 1) {
      fillCodeBoxes(value);
      return;
    }
    const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    setCodeChars((current) => {
      const next = [...current];
      next[index] = cleaned;
      return next;
    });
    if (cleaned && index < CODE_LENGTH - 1) codeInputRefs.current[index + 1]?.focus();
  }

  function handleCodeKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !codeChars[index] && index > 0) {
      codeInputRefs.current[index - 1]?.focus();
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void loadBookingCode();
    }
  }

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
            <div className={`sportscore-odds ${market === "Correct Score" ? "is-score-grid" : ""} ${isFinished ? "is-disabled" : ""}`}>
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
      {/* Dimmed backdrop gives the slip a real "outside" to tap on mobile.
          Without it the sheet hugs the screen edge and there's nowhere
          obvious to press to dismiss it. */}
      {authenticated !== null && slipOpen && (
        <div className="betslip-backdrop" onClick={() => setSlipOpen(false)} aria-hidden="true" />
      )}
      {authenticated !== null && (
        <aside className={`betslip ${slipOpen ? "is-open" : "is-collapsed"}`}>
          {!slipOpen && (
            <button className="betslip-bubble" onClick={() => setSlipOpen(true)} aria-label={`Open bet slip with ${betslipItems.length} selection${betslipItems.length === 1 ? "" : "s"}`}>
              <Ticket size={22} />
              <b>{betslipItems.length}</b>
            </button>
          )}
          {slipOpen && <>
          {/* The sheet itself scrolls — dragging anywhere on it moves through the
              selections, stake, booking code and actions. The navbar and the
              closed-state bubble are the only elements that stay put. */}
          <div className="betslip-head">
            <div className="betslip-heading">
              <span><Ticket size={18} /> BET SLIP <b>{betslipItems.length}</b></span>
              <button className="betslip-collapse" onClick={() => setSlipOpen(false)} aria-label="Minimize bet slip">−</button>
              <button onClick={() => setSlipOpen(false)} aria-label="Close bet slip"><X size={16} /></button>
            </div>
            {/* Multiple (one stake on the whole accumulator) vs Singles
                (each game gets its own stake and is bet separately) —
                the toggle every real sportsbook's slip has. */}
            <div className="betslip-mode" role="tablist" aria-label="Bet type">
              <button
                type="button"
                role="tab"
                aria-selected={!isSingles}
                className={!isSingles ? "is-active" : ""}
                onClick={() => setSlipMode("multiple")}
              >Multiple</button>
              <button
                type="button"
                role="tab"
                aria-selected={isSingles}
                className={isSingles ? "is-active" : ""}
                onClick={() => setSlipMode("singles")}
              >Singles</button>
            </div>
            <div className="betslip-selections">
              {betslipItems.map(([key, bet]) => (
                <div className={`betslip-selection ${isSingles ? "has-stake" : ""}`} key={key}>
                  <span><strong>{bet.option} @ {bet.odds}</strong><small>{bet.match}</small></span>
                  <button onClick={() => setSelectedBets((current) => { const next = { ...current }; delete next[key]; return next; })} aria-label={`Remove ${bet.match}`}><X size={14} /></button>
                  {isSingles && (
                    <label className="betslip-selection-stake">
                      <span>Stake ({currencySymbol(slipCurrency)})</span>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        inputMode="decimal"
                        value={bet.stake ?? ""}
                        placeholder={String(stakeMinimum)}
                        onChange={(event) => setSelectedBets((current) => ({ ...current, [key]: { ...bet, stake: event.target.value } }))}
                        aria-label={`Stake for ${bet.match} in ${slipCurrency}`}
                      />
                    </label>
                  )}
                </div>
              ))}
              {betslipItems.length === 0 && <p className="betslip-empty">Your bet slip is empty. Select an odd to add it here.</p>}
            </div>
            {betslipItems.length > 0 && (
              <button
                type="button"
                className="betslip-clear"
                onClick={() => {
                  setSelectedBets({});
                  setBookingCode(null);
                  setCodeChars(Array(CODE_LENGTH).fill(""));
                  setCodeNotice("");
                  setBetNotice("");
                }}
              >Clear all selections</button>
            )}
            {/* Multiple mode has one stake box for the accumulator. In
                Singles mode every game has its own box above, so the slip
                just reports the total staked. */}
            {!isSingles && (
              <label className="betslip-stake">Stake ({currencySymbol(slipCurrency)})<input type="number" min={stakeMinimum} step="0.01" inputMode="decimal" value={stake} onChange={(event) => setStake(event.target.value)} aria-label={`Stake in ${slipCurrency}`} /></label>
            )}
            {isSingles && (
              <div className="betslip-stake is-total"><span>Total stake ({currencySymbol(slipCurrency)})</span><strong>{formatCustomerAmount(totalStake, slipCurrency)}</strong></div>
            )}
            {/* Minimum stake is always visible above the action button so the
                user knows the floor before tapping "Place bet". */}
            <p className={`betslip-min-stake ${stakeBelowMinimum ? "is-below" : ""}`}>
              {stakeBelowMinimum
                ? (isSingles ? `Single stakes must add up to at least ${formatCustomerAmount(stakeMinimum, slipCurrency)}.` : `Minimum stake is ${formatCustomerAmount(stakeMinimum, slipCurrency)} — enter at least that amount.`)
                : (isSingles ? `Total stakes ${formatCustomerAmount(totalStake, slipCurrency)} · ${formatCustomerAmount(stakeMinimum, slipCurrency)} minimum` : `${minStakeLabel(slipCurrency)}`)}
            </p>
            <div className="betslip-footer"><span>Potential return <small>{betslipItems.length} selection{betslipItems.length === 1 ? "" : "s"}{isSingles ? " · singles" : ""}</small></span><strong>{formatCustomerAmount(potentialReturn, slipCurrency)}</strong></div>
            {/* Booking code — SportyBet style, entirely inside the slip:
                generate (share) and load (enter a code) live here, no
                separate page. */}
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
                    <code>{formatBookingCode(bookingCode)}</code>
                    <button type="button" onClick={() => void copyBookingCode()} aria-label="Copy booking code">
                      {copied ? <CheckCheck size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                  <small>{copied ? "Copied — paste it anywhere" : "Expires in 7 days · anyone with the code can load this slip"}</small>
                </div>
              )}
              <div className="betslip-load-code">
                <span className="betslip-load-code-label">Or load a code from a friend</span>
                <div className="betslip-code-input">
                  {codeChars.map((char, index) => (
                    <input
                      key={index}
                      ref={(el) => { codeInputRefs.current[index] = el; }}
                      value={char}
                      onChange={(event) => handleCodeCharChange(index, event.target.value)}
                      onKeyDown={(event) => handleCodeKeyDown(index, event)}
                      onPaste={(event) => {
                        const pasted = event.clipboardData.getData("text");
                        if (pasted) { event.preventDefault(); fillCodeBoxes(pasted); }
                      }}
                      maxLength={1}
                      inputMode="text"
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      className="betslip-code-char"
                      disabled={loadingCode}
                      aria-label={`Booking code character ${index + 1}`}
                      placeholder="·"
                    />
                  ))}
                </div>
                <button
                  type="button"
                  className="betslip-load-code-button"
                  onClick={() => void loadBookingCode()}
                  disabled={loadingCode || !isValidBookingCode(codeValue)}
                >
                  {loadingCode ? "Loading slip…" : "Load slip"}
                </button>
              </div>
              {codeNotice && <p className="betslip-notice">{codeNotice}</p>}
            </div>
          </div>
          {/* Pinned outside the scrolling area — in Singles mode every
              selection carries a stake box, so the sheet's content gets
              tall. The action must never scroll out of reach. */}
          <div className="betslip-actions">
            {betNotice && <p className="betslip-notice">{betNotice}</p>}
            <button
              className="place-bet-button"
              onClick={() => void placeBet()}
              disabled={placing || betslipItems.length === 0 || stakeBelowMinimum || (!isSingles && (!stake || Number(stake) <= 0))}
            >
              {placing ? "Placing bet..." : "Place bet"}
            </button>
          </div>
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
