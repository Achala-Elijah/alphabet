import { useState } from "react";

type Match = {
  league: string;
  home: string;
  away: string;
  homeCode: string;
  awayCode: string;
  homeLogo?: string | null;
  awayLogo?: string | null;
  time: string;
  odds: string[];
  tag: string;
  slug?: string;
};

/** Crest image when the feed provides one; otherwise the initials circle. */
function TeamCrest({ code, logo, alt, className }: { code: string; logo?: string | null; alt: string; className: string }) {
  const [failed, setFailed] = useState(false);
  if (logo && !failed) {
    return <img className={`${className} team-crest-img`} src={logo} alt={`${alt} logo`} loading="lazy" onError={() => setFailed(true)} />;
  }
  return <span className={className}>{code}</span>;
}

type MatchCardProps = {
  match: Match;
  /** Tapping an odd adds it to the bet slip — same behaviour as the live list. */
  onSelectOdd?: (match: Match, option: string, odds: string) => void;
  selectedOption?: string;
  /** Opens the match detail screen (all markets, like the live list). */
  onOpenMatch?: (match: Match) => void;
};

export default function MatchCard({ match, onSelectOdd, selectedOption, onOpenMatch }: MatchCardProps) {
  return (
    <article className="match-card">
      <button type="button" className="match-card-open" onClick={() => onOpenMatch?.(match)} aria-label={`Open ${match.home} v ${match.away} details`}>
        <div className="match-tags"><span className={match.tag.includes("HOT") ? "hot-tag" : "best-tag"}>{match.tag}</span><span className="league-link">{match.league}</span></div>
        <div className="match-teams">
          <div className="team"><TeamCrest code={match.homeCode} logo={match.homeLogo} alt={match.home} className="team-crest" /><span>{match.home}</span></div>
          <div className="match-time"><strong>{match.time}</strong><span>Today</span></div>
          <div className="team"><TeamCrest code={match.awayCode} logo={match.awayLogo} alt={match.away} className="team-crest alt" /><span>{match.away}</span></div>
        </div>
      </button>
      <div className="odds-row">
        {["1", "X", "2"].map((option, index) => (
          <button
            key={option}
            type="button"
            className={selectedOption === option ? "is-selected" : ""}
            aria-pressed={selectedOption === option}
            onClick={() => onSelectOdd?.(match, option, match.odds[index])}
          >
            <span>{option}</span><strong>{match.odds[index]}</strong>
          </button>
        ))}
      </div>
    </article>
  );
}
