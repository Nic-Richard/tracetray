import { useEffect, useState, type FormEvent } from "react";
import { percent, type ChangeMeasures } from "@tracetray/shared";
import { useApi } from "../api";
import { useSite } from "../state/site";
import { useLoad } from "../lib/useLoad";

interface Row {
  key: keyof ChangeMeasures;
  label: string;
  format: (value: number) => string;
  /** Which way is an improvement; null when a change says nothing about the page itself. */
  better: "up" | "down" | null;
}

const ROWS: Row[] = [
  { key: "visitsPerDay", label: "Visits a day", format: v => v.toFixed(v >= 10 ? 0 : 1), better: null },
  { key: "engaged", label: "Engaged visits", format: v => percent(v), better: "up" },
  { key: "actionsPerVisit", label: "Clicks or taps per visit", format: v => v.toFixed(2), better: null },
  { key: "scrollDepth", label: "Scroll depth", format: v => percent(v), better: null },
  { key: "timeOnPage", label: "Time on page", format: v => `${Math.round(v / 1000)} s`, better: null },
  { key: "phoneShare", label: "On phones", format: v => percent(v), better: null }
];

// Below this many visits on either side a difference is mostly chance, so no verdict is given.
const MIN_VISITS = 30;

const rate = (value: number | null) => value === null ? "–" : percent(value, value < 0.1 ? 1 : 0);

const today = () => new Date().toISOString().slice(0, 10);
const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

function verdict(row: Row, before: number, after: number) {
  if (!row.better || !before) return null;
  const change = (after - before) / before;
  if (Math.abs(change) < 0.03) return "same";
  return (change > 0) === (row.better === "up") ? "better" : "worse";
}

function Comparison({ page, day }: { page: string; day: string }) {
  const api = useApi();
  const { siteKey } = useSite();
  const result = useLoad(() => api.compare(siteKey, page, day), [api, siteKey, page, day]);

  if (result.error) return <p className="page-status error" style={{ padding: 0 }}>{result.error}</p>;
  if (!result.data) return <p className="muted">Comparing…</p>;
  const data = result.data;
  if (!data.ready || !data.before || !data.after) return <p className="muted">Comparisons start once a full day has passed since the change. Check back tomorrow.</p>;
  const { before, after } = data;
  const groups = data.groups;
  const judged = before.visits >= MIN_VISITS && after.visits >= MIN_VISITS;
  const mixShift = before.phoneShare !== null && after.phoneShare !== null && Math.abs(after.phoneShare - before.phoneShare) >= 0.1;

  return (
    <div className="compare">
      <p className="muted">{data.days} day{data.days === 1 ? "" : "s"} before {dayLabel(day)} against {data.days} day{data.days === 1 ? "" : "s"} from it: {before.visits.toLocaleString()} visits before, {after.visits.toLocaleString()} after.</p>
      {data.goal?.verdict === "better" && (
        <p className="win-banner"><b>A win.</b> {data.goal.name} went from {rate(data.goal.before)} to {rate(data.goal.after)} of visits after this change, more than chance would explain.</p>
      )}
      <table>
        <thead><tr><th>Measure</th><th className="right">Before</th><th className="right">After</th><th className="right">Change</th></tr></thead>
        <tbody>
          {data.goal && (
            <tr className="goal-row-compare">
              <td>Reached {data.goal.name}</td>
              <td className="right num">{rate(data.goal.before)}</td>
              <td className="right num">{rate(data.goal.after)}</td>
              <td className="right">{data.goal.verdict === "unclear"
                ? <span className="muted" title="Fewer than 30 visits have reached the goal across both sides">Too early to tell</span>
                : <span className={`verdict ${data.goal.verdict}`}>{data.goal.verdict === "better" ? "Better" : data.goal.verdict === "worse" ? "Worse" : "About the same"}</span>}</td>
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
                <td className="right">{v ? <span className={`verdict ${v}`}>{v === "better" ? "Better" : v === "worse" ? "Worse" : "About the same"}</span> : <span className="muted">{b ? `${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 100)}%` : "–"}</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {data.goal?.verdict === "unclear" && <p className="muted">The goal gets a verdict once 30 visits have reached it across both sides ({data.goal.reached} so far).</p>}
      <p className="muted">Scroll depth and clicks don't get a verdict because either direction can be good: shallower scrolling or fewer clicks can mean people find what they need sooner, or that they give up earlier.</p>
      {!judged && <p className="muted">Fewer than {MIN_VISITS} visits on one side, so these differences could easily be chance. They get more reliable as visits come in.</p>}
      {judged && mixShift && <p className="muted">The share of visits on phones moved from {percent(before.phoneShare!)} to {percent(after.phoneShare!)}. Phone visitors tap and scroll differently, so that alone can move these numbers.</p>}
      <div className="compare-groups">
        <b>Visitor groups</b>
        {groups?.before && groups.after ? (
          <ul>{groups.after.map(g => {
            const was = groups.before!.find(x => x.group === g.group)?.share;
            return <li key={g.group}>{g.group}: {was === undefined ? "new" : percent(was)} → {percent(g.share)}</li>;
          })}</ul>
        ) : (
          <p className="muted">{groups?.after ? "There's no analysis from before this change, so groups can't be compared." : "Refresh the analysis to see how the visitor groups changed."}</p>
        )}
      </div>
    </div>
  );
}

export default function BeforeAfter({ page }: { page: string }) {
  const api = useApi();
  const { siteKey } = useSite();
  const changes = useLoad(() => api.pageChanges(siteKey, page), [api, siteKey, page]);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [day, setDay] = useState(today());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const list = changes.data || [];
  const current = list.find(c => c.id === selected) || list[0] || null;
  useEffect(() => { setSelected(null); setAdding(false); }, [page]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const added = await api.addPageChange(siteKey, { page, day, note });
      setNote("");
      setAdding(false);
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
            <label>Day you changed it<input type="date" value={day} max={today()} onChange={e => setDay(e.target.value)} required /></label>
            <label>What changed<input type="text" value={note} maxLength={120} placeholder="New product photos" onChange={e => setNote(e.target.value)} /></label>
            <button type="submit" className="btn primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          </form>
        )}
        {error && <p className="page-status error" style={{ padding: 0 }}>{error}</p>}
        {changes.error && <p className="page-status error" style={{ padding: 0 }}>{changes.error}</p>}
        {changes.data && list.length === 0 && !adding && (
          <p className="muted">Changed something on this page? Mark the day and TraceTray compares the visits on either side of it.</p>
        )}
        {list.length > 0 && (
          <div className="seg change-list" role="group" aria-label="Marked changes">
            {list.map(c => (
              <button key={c.id} type="button" className={current?.id === c.id ? "on" : ""} onClick={() => setSelected(c.id)}>
                {dayLabel(c.day)}{c.note ? `: ${c.note}` : ""}
              </button>
            ))}
          </div>
        )}
        {current && (
          <>
            <Comparison page={page} day={current.day} />
            <p><button type="button" className="link-button" onClick={() => remove(current.id)}>Remove this change</button></p>
          </>
        )}
      </div>
    </section>
  );
}
