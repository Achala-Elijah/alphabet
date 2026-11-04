"use client";

import AdminShell from "@/components/admin-shell";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { CalendarPlus, LoaderCircle, Plus, Search, Save, Trash2, X } from "lucide-react";

type AdminMatch = {
  slug: string;
  competition: string;
  home: string;
  away: string;
  time: string;
  status_text: string;
  source: string;
  home_score: number | null;
  away_score: number | null;
  current_minute: number | null;
  scheduled_goals?: Array<{ minute: number; team: "home" | "away" }> | null;
};

export default function MatchesPage() {
  const [matches, setMatches] = useState<AdminMatch[]>([]);
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [selectedMatch, setSelectedMatch] = useState<AdminMatch | null>(null);
  const [creating, setCreating] = useState(false);
  const detailsRef = useRef<HTMLElement | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminMatch | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);

  const loadMatches = async () => {
    const response = await fetch("/api/sports/live?sport=football", { cache: "no-store" });
    const data = await response.json() as { matches?: AdminMatch[]; error?: string };
    if (!response.ok) throw new Error(data.error || "Unable to load matches.");
    setMatches(data.matches || []);
  };

  useEffect(() => {
    void loadMatches().catch((err: unknown) => setError(err instanceof Error ? err.message : "Unable to load matches."));
    const interval = window.setInterval(() => void loadMatches().catch((err: unknown) => setError(err instanceof Error ? err.message : "Unable to refresh matches.")), 15_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedMatch) {
      window.requestAnimationFrame(() => detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }, [selectedMatch]);

  const filteredMatches = useMemo(() => matches.filter((match) =>
    `${match.competition} ${match.home} ${match.away}`.toLowerCase().includes(query.toLowerCase())
  ), [matches, query]);

  async function createMatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    setSaving(true);
    setError("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const response = await fetch("/api/sports/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          home: form.get("home"),
          away: form.get("away"),
          competition: form.get("competition"),
          time: new Date(String(form.get("time"))).toISOString(),
          odds: ["1.90", "3.20", "2.10"],
          scheduled_goals: [
            ...String(form.get("homeGoals") || "").split(",").filter(Boolean).map((minute) => ({ minute: Number(minute.trim()), team: "home" as const })),
            ...String(form.get("awayGoals") || "").split(",").filter(Boolean).map((minute) => ({ minute: Number(minute.trim()), team: "away" as const }))
          ].filter((goal) => Number.isInteger(goal.minute) && goal.minute >= 0 && goal.minute <= 120)
        })
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to create match.");
      formElement.reset();
      setShowForm(false);
      await loadMatches();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create match.");
    } finally {
      setSaving(false);
      setCreating(false);
    }
  }

  async function updateMatch(match: AdminMatch, changes: Record<string, number | string | Array<{ minute: number; team: "home" | "away" }>>) {
    try {
      setError("");
      const response = await fetch("/api/sports/live", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: match.slug, ...changes }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to update match.");
      await loadMatches();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update match.");
      return false;
    }
  }

  async function deleteMatch(match: AdminMatch) {
    if (match.source !== "BETKIING" && match.source !== "AlphaBet") return;
    setDeleteTarget(match);
  }

  async function confirmDeleteMatch() {
    if (!deleteTarget) return;
    setDeleteSaving(true);
    try {
      setError("");
      const response = await fetch(`/api/sports/live?id=${encodeURIComponent(deleteTarget.slug)}`, { method: "DELETE" });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to delete match.");
      if (selectedMatch?.slug === deleteTarget.slug) setSelectedMatch(null);
      setDeleteTarget(null);
      await loadMatches();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete match.");
    } finally {
      setDeleteSaving(false);
    }
  }

  async function saveEditedMatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedMatch) return;
    setEditSaving(true);
    const form = new FormData(event.currentTarget);
    const scheduledGoals = [
      ...String(form.get("editHomeGoals") || "").split(",").filter(Boolean).map((minute) => ({ minute: Number(minute.trim()), team: "home" as const })),
      ...String(form.get("editAwayGoals") || "").split(",").filter(Boolean).map((minute) => ({ minute: Number(minute.trim()), team: "away" as const }))
    ].filter((goal) => Number.isInteger(goal.minute) && goal.minute >= 0 && goal.minute <= 120);
    try {
      const updated = await updateMatch(selectedMatch, {
        competition: String(form.get("editCompetition") || "").trim(),
        home: String(form.get("editHome") || "").trim(),
        away: String(form.get("editAway") || "").trim(),
        kickoff: new Date(String(form.get("editKickoff"))).toISOString(),
        scheduled_goals: scheduledGoals
      });
      if (updated) setSelectedMatch(null);
    } finally {
      setEditSaving(false);
    }
  }

  return <AdminShell title="Match management" description="Manage live fixtures, generated games, and betting markets.">
    <div className="toolbar">
      <div className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search matches..." /></div>
      <button className="primary-button" onClick={() => setShowForm(true)}><Plus size={17} /> Add match</button>
    </div>
    {error && <div className="admin-inline-error">{error}</div>}
    {showForm && <form className="admin-card match-form" onSubmit={(event) => void createMatch(event)}>
      <div className="card-heading"><div><h2>Create an AlphaBet fixture</h2><p>This match will appear in the customer sportsbook.</p></div><button type="button" className="dots" onClick={() => setShowForm(false)} aria-label="Close"><X size={18} /></button></div>
      <div className="match-form-grid">
        <label>Competition<input name="competition" required placeholder="England · Premier League" /></label>
        <label>Kick-off<input name="time" type="datetime-local" required /></label>
        <label>Home team<input name="home" required placeholder="Home team" /></label>
        <label>Away team<input name="away" required placeholder="Away team" /></label>
        <label>Home goals at minutes<input name="homeGoals" placeholder="Example: 18, 72" /></label>
        <label>Away goals at minutes<input name="awayGoals" placeholder="Example: 44, 85" /></label>
      </div>
      <p className="form-help">Goals are scheduled against the match clock and will appear automatically when the game reaches those minutes.</p>
      <button type="submit" className="primary-button" disabled={saving || creating}>{saving || creating ? <LoaderCircle className="spin" size={16} /> : <CalendarPlus size={16} />} {saving || creating ? "Creating..." : "Create fixture"}</button>
    </form>}
    <section className="admin-card table-card"><div className="table-wrap"><table><thead><tr><th>Competition</th><th>Home team</th><th>Away team</th><th>Kick-off</th><th>Source</th><th>Status</th><th></th></tr></thead><tbody>
      {filteredMatches.map((match) => <tr key={match.slug} onClick={() => setSelectedMatch(match)} className="match-row-clickable"><td>{match.competition}</td><td>{match.home}</td><td>{match.away}</td><td>{new Date(match.time).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td><td><span className="status pending">{match.source}</span></td><td><span className={`status ${match.status_text === "Live" ? "live" : "pending"}`}>{match.status_text}</span>{(match.source === "BETKIING" || match.source === "AlphaBet") && <div className="match-score-controls"><strong>{match.home_score ?? 0} - {match.away_score ?? 0} · {match.current_minute ?? 0}'</strong><button type="button" onClick={(event) => { event.stopPropagation(); void updateMatch(match, { current_minute: (match.current_minute || 0) + 1, status: "live" }); }}>+1 min</button><button type="button" onClick={(event) => { event.stopPropagation(); void updateMatch(match, { status: match.status_text === "Live" ? "finished" : "live" }); }}>{match.status_text === "Live" ? "Finish match" : "Start live"}</button></div>}</td><td><button type="button" className="secondary-button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setSelectedMatch(match); }}>Edit</button></td></tr>)}
      {filteredMatches.length === 0 && <tr><td colSpan={7} className="empty-table">No matches found.</td></tr>}
    </tbody></table></div></section>
    {selectedMatch && <div className="match-edit-overlay" role="dialog" aria-modal="true" aria-labelledby="match-edit-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedMatch(null); }}><section ref={detailsRef} className="admin-card match-details-card"><div className="card-heading"><div><span className="modal-eyebrow">FIXTURE EDITOR</span><h2 id="match-edit-title">{selectedMatch.home} <span>vs</span> {selectedMatch.away}</h2><p>Update fixture details and scheduled goals.</p></div><button type="button" className="dots" onClick={() => setSelectedMatch(null)} aria-label="Close details"><X size={18} /></button></div>{selectedMatch.source === "BETKIING" || selectedMatch.source === "AlphaBet" ? <form onSubmit={(event) => void saveEditedMatch(event)}><div className="match-form-grid"><label>Competition<input name="editCompetition" required defaultValue={selectedMatch.competition} /></label><label>Kick-off<input name="editKickoff" required type="datetime-local" defaultValue={new Date(selectedMatch.time).toISOString().slice(0, 16)} /></label><label>Home team<input name="editHome" required defaultValue={selectedMatch.home} /></label><label>Away team<input name="editAway" required defaultValue={selectedMatch.away} /></label><label>Home goal minutes<input name="editHomeGoals" placeholder="18, 72" defaultValue={(selectedMatch.scheduled_goals || []).filter((goal) => goal.team === "home").map((goal) => goal.minute).join(", ")} /></label><label>Away goal minutes<input name="editAwayGoals" placeholder="44, 85" defaultValue={(selectedMatch.scheduled_goals || []).filter((goal) => goal.team === "away").map((goal) => goal.minute).join(", ")} /></label></div><p className="form-help">Use comma-separated minutes. Changes are saved together when you click Update match.</p><div className="modal-actions"><button type="button" className="danger-button" onClick={() => void deleteMatch(selectedMatch)}><Trash2 size={16} /> Delete match</button><div><button type="button" className="secondary-button" onClick={() => setSelectedMatch(null)}>Cancel</button><button type="submit" className="primary-button" disabled={editSaving}>{editSaving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />} {editSaving ? "Updating..." : "Update match"}</button></div></div></form> : <p>This external fixture is read-only.</p>}</section></div>}
    {deleteTarget && <div className="match-edit-overlay match-confirm-overlay" role="alertdialog" aria-modal="true" aria-labelledby="delete-match-title"><section className="admin-card match-confirm-card"><div className="confirm-icon"><Trash2 size={22} /></div><h2 id="delete-match-title">Delete this match?</h2><p>This will permanently remove <strong>{deleteTarget.home} vs {deleteTarget.away}</strong>. This action cannot be undone.</p><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setDeleteTarget(null)} disabled={deleteSaving}>Keep match</button><button type="button" className="danger-button" onClick={() => void confirmDeleteMatch()} disabled={deleteSaving}>{deleteSaving ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />} {deleteSaving ? "Deleting..." : "Yes, delete match"}</button></div></section></div>}
  </AdminShell>;
}
