import { useEffect, useState, type FormEvent } from "react";
import { percent, COMPARISON_ROWS as ROWS, COMPARISON_MIN_VISITS as MIN_VISITS, COMPARISON_WAITING, COMPARISON_TRAFFIC_NOTE, comparisonStatus, comparisonGoalSummary, comparisonGroupScope, comparisonPeriods, comparisonRate as rate, comparisonVerdict as verdict, type FindingReference, type PageChange } from "@tracetray/shared";
import { useApi } from "../api";
import { useSite } from "../state/site";
import { useLoad } from "../lib/useLoad";
import FindingEvidence from "./FindingEvidence";

const today = () => new Date().toISOString().slice(0, 10);
const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

function Comparison({ page, change }: { page: string; change: PageChange }) {
  const api = useApi();
  const { siteKey } = useSite();
  const { day } = change;
  const result = useLoad(() => api.compare(siteKey, page, day, change.id), [api, siteKey, page, day, change.id]);

  if (result.error) return <p className="page-status error" style={{ padding: 0 }}>{result.error}</p>;
  if (!result.data) return <p className="muted">Comparing…</p>;
  const data = result.data;
  if (!data.ready || !data.before || !data.after) return <><p className="muted">{COMPARISON_WAITING}</p><p className="muted">{comparisonStatus(data)}</p></>;
  const { before, after } = data;
  const groups = data.groups;
  const judged = before.visits >= MIN_VISITS && after.visits >= MIN_VISITS;
  const mixShift = before.phoneShare !== null && after.phoneShare !== null && Math.abs(after.phoneShare - before.phoneShare) >= 0.1;

  return (
    <div className="compare">
      <p className="muted">{data.days} complete day{data.days === 1 ? "" : "s"} on each side of {dayLabel(day)}, excluding the change day: {before.visits.toLocaleString()} visits before, {after.visits.toLocaleString()} after.</p>
      <p className="muted">{comparisonPeriods(day, data.days, data.device)}</p>
      {data.provisional && <p className="muted">Provisional: collecting 14 complete days after the change. No conclusion yet.</p>}
      {comparisonStatus(data) && <p className="muted">{comparisonStatus(data)}</p>}
      <p className="muted">{COMPARISON_TRAFFIC_NOTE}</p>
      {data.goal && <p>{comparisonGoalSummary(data.goal)}</p>}
      {data.goal && <p className="muted">Goal completions: {data.goal.before_reached} before; {data.goal.after_reached} after.</p>}
      <table>
        <thead><tr><th>Measure</th><th className="right">Before</th><th className="right">After</th><th className="right">Change</th></tr></thead>
        <tbody>
          {data.goal && (
            <tr className="goal-row-compare">
              <td>Reached {data.goal.name}</td>
              <td className="right num">{rate(data.goal.before)}</td>
              <td className="right num">{rate(data.goal.after)}</td>
              <td className="right">{data.goal.verdict === "unclear"
                ? <span className="muted" title="Needs 14 complete days, 30 visits on each side and 30 goal completions across both">Inconclusive</span>
                : <span className={`verdict ${data.goal.verdict}`}>{data.goal.verdict === "better" ? "Higher rate" : data.goal.verdict === "worse" ? "Lower rate" : "No clear difference"}</span>}</td>
            </tr>
          )}
          {ROWS.map(row => {
            const b = before[row.key], a = after[row.key];
            if (b === null || a === null) return null;
            const v = judged ? verdict(row, b, a) : null;
            return (
              <tr key={row.key}>
                <td>{row.label}</td>
                <td className="right num">{row.format(b)}</td>
                <td className="right num">{row.format(a)}</td>
                <td className="right">{v ? <span className={`verdict ${v}`}>{v === "better" ? "Rose" : v === "worse" ? "Fell" : "Little change"}</span> : <span className="muted">{b ? `${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 100)}%` : "–"}</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {data.goal?.verdict === "unclear" && <p className="muted">A direction is reported after 14 complete days, with at least 30 visits on each side and 30 goal completions across both ({data.goal.reached} so far). Otherwise the result stays inconclusive.</p>}
      <p className="muted">Scroll depth and clicks don't get a verdict because either direction can be good: shallower scrolling or fewer clicks can mean people find what they need sooner, or that they give up earlier.</p>
      <p className="muted">Other measures show observed changes only; their labels don't include a statistical uncertainty test.</p>
      {!judged && <p className="muted">Fewer than {MIN_VISITS} visits on one side, so these differences could easily be chance. They get more reliable as visits come in.</p>}
      {judged && mixShift && <p className="muted">The share of visits on phones moved from {percent(before.phoneShare!)} to {percent(after.phoneShare!)}. Phone visitors tap and scroll differently, so that alone can move these numbers.</p>}
      {!change.finding && <div className="compare-groups">
        <b>Visitor groups</b>
        <p className="muted">Group snapshots use their own analysis periods and may overlap. They don't isolate visits before and after this change.</p>
        {groups?.before && <p className="muted">Before snapshot: {comparisonGroupScope(groups.before_scope)}</p>}
        {groups?.after && <p className="muted">After snapshot: {comparisonGroupScope(groups.after_scope)}</p>}
        {groups?.before && groups.after ? (
          <ul>{groups.after.map(g => {
            const was = groups.before!.find(x => x.group === g.group)?.share;
            return <li key={g.group}>{g.group}: {was === undefined ? "new" : percent(was)} → {percent(g.share)}</li>;
          })}</ul>
        ) : (
          <p className="muted">{groups?.after ? "There's no analysis from before this change, so groups can't be compared." : "Refresh the analysis to see how the visitor groups changed."}</p>
        )}
      </div>}
    </div>
  );
}

export default function BeforeAfter({ page, source }: { page: string; source?: FindingReference }) {
  const api = useApi();
  const { siteKey } = useSite();
  const changes = useLoad(() => api.pageChanges(siteKey, page), [api, siteKey, page]);
  const draft = useLoad(() => source ? api.changeFinding(siteKey, page, source) : null, [api, siteKey, page, source]);
  const [selected, setSelected] = useState<string | null>(null);
  const [savedChange, setSavedChange] = useState<PageChange | null>(null);
  const [adding, setAdding] = useState(!!source);
  const [day, setDay] = useState(today());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const list = changes.data || [];
  const current = (selected === savedChange?.id ? savedChange : list.find(c => c.id === selected)) || list[0] || null;
  useEffect(() => { setSelected(null); setSavedChange(null); setAdding(!!source); setDay(today()); setNote(""); setError(""); }, [siteKey, page, source]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const added = await api.addPageChange(siteKey, { page, day, note, ...(source ? { source } : {}) });
      setNote("");
      setAdding(false);
      setSavedChange(added);
      setSelected(added.id);
      changes.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      await api.deletePageChange(siteKey, id);
      setSelected(null);
      setSavedChange(null);
      changes.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That wasn't removed");
    }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Before and after a change</h2>
        <div className="end"><button type="button" className="btn" onClick={() => setAdding(a => !a)}>{adding ? "Cancel" : "Mark a change"}</button></div>
      </div>
      <div className="panel-body before-after">
        {adding && (
          <form className="change-form" onSubmit={save}>
            {source && (draft.error ? <><p role="alert" className="error">{draft.error}</p><button type="button" className="btn" onClick={draft.reload}>Retry finding</button></> : draft.data ? <FindingEvidence finding={draft.data} /> : <p>Loading the original finding…</p>)}
            <p className="note">Record this only after making the change. New visits are needed before comparing; the change day is excluded.</p>
            <label>Day you changed it (UTC)<input type="date" value={day} min={source?.ran_at.slice(0, 10)} max={today()} onChange={e => setDay(e.target.value)} required /></label>
            <label>What you actually changed<input type="text" value={note} maxLength={120} placeholder="New product photos" required={!!source} onChange={e => setNote(e.target.value)} /></label>
            <button type="submit" className="btn primary" disabled={saving || !!source && (draft.loading || !!draft.error || !draft.data)}>{saving ? "Saving…" : "Record completed change"}</button>
          </form>
        )}
        {error && <p className="page-status error" style={{ padding: 0 }}>{error}</p>}
        {changes.error && <p className="page-status error" style={{ padding: 0 }}>{changes.error}</p>}
        {changes.data && list.length === 0 && !adding && (
          <p className="muted">Changed something on this page? Mark the day and TraceTray compares the visits on either side of it.</p>
        )}
        {list.length > 0 && !adding && (
          <div className="seg change-list" role="group" aria-label="Marked changes">
            {list.map(c => (
              <button key={c.id} type="button" className={current?.id === c.id ? "on" : ""} onClick={() => setSelected(c.id)}>
                {dayLabel(c.day)}{c.note ? `: ${c.note}` : ""}
              </button>
            ))}
          </div>
        )}
        {current && !adding && (
          <>
            {current.finding && <FindingEvidence finding={current.finding} />}
            {current.goal_snapshot && <p className="note">Recorded goal: {current.goal_snapshot.name}.</p>}
            <Comparison key={current.id} page={page} change={current} />
            <p><button type="button" className="link-button" onClick={() => remove(current.id)}>Remove this change</button></p>
          </>
        )}
      </div>
    </section>
  );
}
