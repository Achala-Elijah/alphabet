"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Trophy, Tv, Share2, Plane, Sparkles, Search, ChevronLeft, ChevronRight } from "lucide-react";
import ClientHeader from "@/components/client-header";
import ClientBottomNav from "@/components/client-bottom-nav";
import MatchCard from "@/components/match-card";
import SectionTitle from "@/components/section-title";
import { featuredMatches } from "@/lib/mock-data";
import LiveScores from "@/components/live-scores";
import { addSelectionToSlip, readBetSlip, BET_SLIP_UPDATED_EVENT, type BetSlipSelection } from "@/lib/bet-slip";

type FeaturedMatch = (typeof featuredMatches)[number] & { slug?: string; homeLogo?: string | null; awayLogo?: string | null };

/** The bet slip keys selections by match slug (or a stable name pair when a
 *  placeholder card has no slug yet) — the featured card must use the same. */
function featuredMatchId(match: FeaturedMatch) {
  return match.slug || `${match.home}|${match.away}`;
}

const promos = [
  { title: "Premier League", sub: "THE BIGGEST MATCHES", art: "⚽", style: "promo-blue" },
  { title: "Serie A", sub: "ITALIAN FOOTBALL", art: "🏆", style: "promo-red" },
  { title: "Lucky Numbers", sub: "PLAY & WIN", art: "✨", style: "promo-gold" },
  { title: "Match of the Day", sub: "BEST ODDS", art: "🛡️", style: "promo-navy" },
  { title: "Casino Cashback", sub: "MORE REWARDS", art: "🎰", style: "promo-purple" }
];
const shortcuts = [
  { label: "All Sports", Icon: Trophy }, { label: "Live", Icon: Tv }, { label: "Share Slip", Icon: Share2 },
  { label: "Aviator", Icon: Plane }, { label: "Virtuals", Icon: Sparkles }, { label: "Verify Bet", Icon: Search }
];
const sports = ["LIVE", "Football", "Table Tennis", "Tennis", "Basketball"];
const marketsBySport: Record<string, string[]> = {
  LIVE: ["1X2", "O/U", "DC", "1st Half O/U", "Handicap", "Correct Score"],
  Football: ["1X2", "O/U", "DC", "1st Half O/U", "Handicap", "Correct Score"],
  Tennis: ["Match Winner", "Set Betting", "Total Games", "Game Handicap"],
  Basketball: ["Moneyline", "Totals", "1st Half", "Handicap"],
  "Table Tennis": ["Match Winner", "Set Betting", "Total Sets", "Handicap"]
};

function HomeContent() {
  const router = useRouter();
  // Derived straight from the URL so tapping Home <-> Games in the bottom
  // nav re-renders the right view. Reading it once on mount (the old way)
  // never updated after a client-side navigation, so the two tabs fought
  // over which view was actually on screen.
  const searchParams = useSearchParams();
  const searchQuery = searchParams.get("q") || "";
  // A search always uses the sports feed, even if the Games tab was active.
  const gamesView = searchParams.get("nav") === "games" && !searchQuery.trim();
  const sportParam = searchParams.get("sport");

  const [sport, setSport] = useState("Football");
  const [market, setMarket] = useState("1X2");
  const [featured, setFeatured] = useState(0);
  // The API is the only source of featured fixtures. The old hard-coded
  // placeholders were real matches from past rounds and could appear on the
  // home page before the feed answered.
  const [apiFeatured, setApiFeatured] = useState<FeaturedMatch[]>([]);
  // Mirror the persisted slip so featured odds light up when selected, and
  // dim again when the selection is removed anywhere else.
  const [slipSelections, setSlipSelections] = useState<Record<string, BetSlipSelection>>({});
  const markets = marketsBySport[sport] || marketsBySport.Football;
  const selectSport = (nextSport: string) => {
    setSport(nextSport);
    setMarket(marketsBySport[nextSport][0]);
  };

  // A search result carries its sport in the URL so the home page opens the
  // right feed before the match detail is shown.
  useEffect(() => {
    if (sportParam && sports.includes(sportParam)) {
      setSport(sportParam);
      setMarket(marketsBySport[sportParam]?.[0] || "1X2");
    }
  }, [sportParam]);

  useEffect(() => {
    const sync = () => setSlipSelections(readBetSlip().selections);
    sync();
    window.addEventListener(BET_SLIP_UPDATED_EVENT, sync);
    return () => window.removeEventListener(BET_SLIP_UPDATED_EVENT, sync);
  }, []);

  useEffect(() => {
    if (gamesView) return;
    let cancelled = false;
    fetch("/api/sports/live?sport=football&featured=true", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load featured matches");
        return response.json();
      })
      .then((data: { matches?: Array<{ home?: string; away?: string; home_logo?: string | null; away_logo?: string | null; competition?: string; time?: string; odds?: string[]; market_odds?: Record<string, Record<string, string>>; slug?: string }> }) => {
        if (cancelled || !Array.isArray(data.matches)) return;
        // Prefer the API's 1X2 from market_odds so featured cards match the
        // odds in the live list — both come from generateAllMarketOdds.
        setApiFeatured(data.matches.map((match, index) => {
          const date = match.time ? new Date(match.time) : null;
          const oneX2 = match.market_odds?.["1X2"];
          const apiOdds = oneX2 ? [oneX2["1"] || "1.90", oneX2["X"] || "3.10", oneX2["2"] || "3.20"] : match.odds?.length ? match.odds : ["1.90", "3.10", "3.20"];
          return {
            league: match.competition || "Football",
            home: match.home || "Home team",
            away: match.away || "Away team",
            homeLogo: match.home_logo || null,
            awayLogo: match.away_logo || null,
            homeCode: (match.home || "HT").slice(0, 2).toUpperCase(),
            awayCode: (match.away || "AT").slice(0, 2).toUpperCase(),
            time: date && !Number.isNaN(date.getTime()) ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "TBA",
            odds: apiOdds,
            slug: match.slug,
            tag: index === 0 ? "FEATURED" : "BEST ODDS"
          };
        }));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [gamesView]);

  const featuredCount = apiFeatured.length;
  const primaryFeatured = featuredCount ? apiFeatured[featured % featuredCount] : null;
  const secondaryFeatured = featuredCount > 1 ? apiFeatured[(featured + 1) % featuredCount] : null;
  const openFeaturedMatch = (match: FeaturedMatch) => {
    if (!match.slug) return;
    const focus = Date.now().toString(36);
    router.push(`/?sport=Football&match=${encodeURIComponent(match.slug)}&focus=${focus}`, { scroll: false });
  };

  return (
    <div className="client-app">
      <ClientHeader />
      {gamesView ? <main className="games-coming-soon">
        <div className="games-coming-soon-icon"><Sparkles size={34} /></div>
        <span className="auth-eyebrow">COMING SOON</span>
        <h1>Games are launching soon</h1>
        <p>We are preparing an exciting games experience for AlphaBet. Check back soon for more ways to play.</p>
        <button onClick={() => router.replace("/")}>Back to sports</button>
      </main> : <main className="client-main">
        <div className="promo-strip">{promos.map(p => <button key={p.title} className={`promo-tile ${p.style}`}><span className="promo-art">{p.art}</span><span className="promo-title">{p.title}</span><small>{p.sub}</small></button>)}</div>
        <div className="shortcut-row">{shortcuts.map(({ label, Icon }) => <button key={label} onClick={() => {
          if (label === "Live") selectSport("LIVE");
          if (label === "All Sports") selectSport("Football");
        }}><Icon size={27} strokeWidth={1.6} /><span>{label}</span></button>)}</div>
        {sport === "Football" && primaryFeatured && <section className="featured-section">
          <div className="featured-heading"><h2><span>♜</span> FEATURED MATCHES</h2><div className="slider-controls"><button onClick={() => setFeatured((featured + featuredCount - 1) % featuredCount)} aria-label="Previous"><ChevronLeft /></button><button onClick={() => setFeatured((featured + 1) % featuredCount)} aria-label="Next"><ChevronRight /></button></div><span className="best-odds-heading">BEST ODDS</span></div>
          <div className="league-tabs"><button className="selected">Top Football</button></div>
          <div className="featured-track"><MatchCard
            match={primaryFeatured}
            selectedOption={slipSelections[featuredMatchId(primaryFeatured)]?.option}
            onOpenMatch={openFeaturedMatch}
            onSelectOdd={(match, option, odds) => addSelectionToSlip({
              match: `${match.home} v ${match.away}`,
              matchId: featuredMatchId(match),
              option,
              odds,
              market: "1X2"
            })}
          />{secondaryFeatured && <MatchCard
            match={secondaryFeatured}
            selectedOption={slipSelections[featuredMatchId(secondaryFeatured)]?.option}
            onOpenMatch={openFeaturedMatch}
            onSelectOdd={(match, option, odds) => addSelectionToSlip({
              match: `${match.home} v ${match.away}`,
              matchId: featuredMatchId(match),
              option,
              odds,
              market: "1X2"
            })}
          />}</div>
        </section>}
        <div className="sport-tabs">{sports.map(s => <button key={s} className={sport === s ? "active" : ""} onClick={() => selectSport(s)}>{s}</button>)}</div>
        <div className="market-tabs">{markets.map(m => <button key={m} className={market === m ? "active" : ""} onClick={() => setMarket(m)}>{m}</button>)}</div>
        <LiveScores sport={sport} market={market} query={searchQuery} />
      </main>}
      <Suspense fallback={null}><ClientBottomNav /></Suspense>
    </div>
  );
}

export default function HomePage() {
  // useSearchParams needs a Suspense boundary above it, otherwise the whole
  // route bails out to client rendering.
  return (
    <Suspense fallback={null}>
      <HomeContent />
    </Suspense>
  );
}
