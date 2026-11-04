type Match = { league: string; home: string; away: string; homeCode: string; awayCode: string; time: string; odds: string[]; tag: string };

export default function MatchCard({ match }: { match: Match }) {
  return (
    <article className="match-card">
      <div className="match-tags"><span className={match.tag.includes("HOT") ? "hot-tag" : "best-tag"}>{match.tag}</span><span className="league-link">{match.league}</span></div>
      <div className="match-teams">
        <div className="team"><span className="team-crest">{match.homeCode}</span><span>{match.home}</span></div>
        <div className="match-time"><strong>{match.time}</strong><span>Today</span></div>
        <div className="team"><span className="team-crest alt">{match.awayCode}</span><span>{match.away}</span></div>
      </div>
      <div className="odds-row">{["1", "X", "2"].map((v, i) => <button key={v}><span>{v}</span><strong>{match.odds[i]}</strong></button>)}</div>
    </article>
  );
}
