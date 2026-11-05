type Match = {
  league: string;
  home: string;
  away: string;
  homeCode: string;
  awayCode: string;
  time: string;
  odds: string[];
  tag: string;
  slug?: string;
};

type MatchCardProps = {
  match: Match;
  /** Tapping an odd adds it to the bet slip — same behaviour as the live list. */
  onSelectOdd?: (match: Match, option: string, odds: string) => void;
  selectedOption?: string;
};

export default function MatchCard({ match, onSelectOdd, selectedOption }: MatchCardProps) {
  return (
    <article className="match-card">
      <div className="match-tags"><span className={match.tag.includes("HOT") ? "hot-tag" : "best-tag"}>{match.tag}</span><span className="league-link">{match.league}</span></div>
      <div className="match-teams">
        <div className="team"><span className="team-crest">{match.homeCode}</span><span>{match.home}</span></div>
        <div className="match-time"><strong>{match.time}</strong><span>Today</span></div>
        <div className="team"><span className="team-crest alt">{match.awayCode}</span><span>{match.away}</span></div>
      </div>
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
