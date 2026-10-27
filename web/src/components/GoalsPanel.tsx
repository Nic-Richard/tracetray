import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "react-router";
import { comparisonPeriods, describeGoal, formLabel, pageLabel, percent, type Goal, type GoalType } from "@tracetray/shared";
import { useApi } from "../api";
import { useSite } from "../state/site";
import { useLoad } from "../lib/useLoad";
const asPercent = (value: number) => percent(value, value < 0.1 ? 1 : 0);

function GoalRow({ goal, onChanged }: { goal: Goal; onChanged: () => void }) {
  const api = useApi();
  const { siteKey } = useSite();
  const [editing, setEditing] = useState<"name" | "target" | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError("");
    try {
      await action();
      setEditing(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  }

  function open(mode: "name" | "target") {
    setEditing(mode);
    setValue(mode === "name" ? goal.name : goal.target != null ? String(+(goal.target * 100).toFixed(2)) : "");
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (editing === "name") return run(() => api.editGoal(siteKey, goal.id, { name: value }));
    const target = value.trim() === "" ? null : Number(value) / 100;
    return run(() => api.editGoal(siteKey, goal.id, { name: goal.name, target }));
  }

  const checking = goal.backfill === "queued" || goal.backfill === "running";
  return (
    <li className="goal-row">
      {editing === null ? (
        <span>
          <b>{goal.name}</b>
          <small>{describeGoal(goal)}{goal.target != null ? ` · target ${asPercent(goal.target)}` : ""}</small>
          <small>{checking ? "Checking past visits…" : goal.backfill === "failed" ? "Couldn't check past visits; new visits still count." : goal.reached_last_7_days ? `Reached ${goal.reached_last_7_days.toLocaleString()} times in the last 7 days` : "No matches in the last 7 days"}</small>
          {!checking && (goal.reached_all_time || 0) > 0 && (
            <small>{goal.reached_all_time!.toLocaleString()} all time{goal.next_milestone ? ` · next milestone ${goal.next_milestone.toLocaleString()}` : ""}</small>
          )}
          {goal.milestone_this_week && <span className="goal-tag milestone">Passed {goal.milestone_this_week.toLocaleString()} this week</span>}
        </span>
      ) : (
        <form className="inline-form" onSubmit={save}>
          {editing === "name"
            ? <input value={value} onChange={event => setValue(event.target.value)} aria-label="Goal name" maxLength={60} autoFocus />
            : <label className="target-input"><input type="number" min="0.1" max="100" step="0.1" value={value} onChange={event => setValue(event.target.value)} aria-label="Target, percent of visits" placeholder="5" autoFocus /> % of visits</label>}
          <button type="submit" className="btn" disabled={busy || (editing === "name" && !value.trim())}>Save</button>
          {editing === "target" && goal.target != null && <button type="button" className="link-button" onClick={() => run(() => api.editGoal(siteKey, goal.id, { name: goal.name, target: null }))}>Clear target</button>}
          <button type="button" className="link-button" onClick={() => setEditing(null)}>Cancel</button>
        </form>
      )}
      {editing === null && (
        <span className="row-actions">
          <button type="button" className="link-button" onClick={() => open("target")} disabled={busy}>{goal.target != null ? "Change target" : "Set target"}</button>
          <button type="button" className="link-button" onClick={() => open("name")} disabled={busy}>Rename</button>
          <button type="button" className="link-button danger" onClick={() => run(() => api.removeGoal(siteKey, goal.id))} disabled={busy}>Remove</button>
        </span>
      )}
      {error && <p className="form-error">{error}</p>}
    </li>
  );
}

function Wins() {
  const api = useApi();
  const { siteKey } = useSite();
  const wins = useLoad(() => api.wins(siteKey), [api, siteKey]);
  if (!wins.data?.length) return null;
  return (
    <div className="wins">
      <h3>Goal-rate rises</h3>
      <p className="muted">These rises exceed the comparison's sampling threshold. Other changes in traffic or timing could explain them; they don't establish that a page change caused the rise.</p>
      <ul className="rule-list">
        {wins.data.map(win => (
          <li key={win.id}>
            <span>
              <b>{pageLabel(win.page)}{win.note ? `: ${win.note}` : ""}</b>
              <small>{win.goal} went from {win.before === null ? "–" : asPercent(win.before)} to {win.after === null ? "–" : asPercent(win.after)} after {new Date(`${win.day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}</small>
              {win.days != null && <small>{comparisonPeriods(win.day, win.days, win.device)} {win.before_visits?.toLocaleString()} visits before, {win.after_visits?.toLocaleString()} after.</small>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function GoalsPanel() {
  const api = useApi();
  const { siteKey, site, pages } = useSite();
  const { hash } = useLocation();
  const list = useLoad(() => api.goals(siteKey), [api, siteKey]);
  const [type, setType] = useState<GoalType>("click");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [target, setTarget] = useState("");
  const [form, setForm] = useState("");
  const forms = useLoad(() => type === "form" ? api.forms(siteKey) : null, [api, siteKey, type]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (hash === "#goals") document.getElementById("goals")?.scrollIntoView({ block: "start" });
  }, [hash, list.data]);

  // Past visits are checked in the background; refresh until every goal is done.
  const checking = list.data?.goals.some(g => g.backfill === "queued" || g.backfill === "running");
  useEffect(() => {
    if (!checking) return;
    const timer = setInterval(list.reload, 4000);
    return () => clearInterval(timer);
  }, [checking, list.reload]);

  async function add(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      const sent = forms.data?.[Number(form)];
      const match = type === "click" ? { text }
        : type === "form" ? (sent?.id ? { id: sent.id } : sent?.name ? { name: sent.name } : { action: sent?.action })
        : { page: target };
      const fallback = type === "click" ? text : type === "form" ? formLabel(sent) : pageLabel(target);
      await api.addGoal(siteKey, { name: name || fallback, type, match });
      setName(""); setText(""); setTarget(""); setForm("");
      list.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The goal wasn't saved");
    } finally {
      setSaving(false);
    }
  }

  const goals = list.data?.goals || [];
  const full = list.data ? goals.length >= list.data.cap : false;
  const ready = type === "click" ? text.trim() : type === "form" ? form : target;
  return (
    <section className="panel" id="goals">
      <div className="panel-head">
        <h2>Goals</h2>
        {list.data && <div className="end"><span className="ask-note">{goals.length} {goals.length === 1 ? "goal" : "goals"} · up to {list.data.cap}</span></div>}
      </div>
      <div className="panel-body setup-copy">
        <p>A goal is what a page is for: a button or link people click, a form they send, or a page they go on to, like checkout or a thank-you page. Each page then shows how many visits reached it, and new goals are checked against past visits too.</p>
        {list.error && <p className="form-error">{list.error}</p>}
        {list.data && (
          <ul className="rule-list goal-list">
            {goals.length === 0 && <li className="muted">No goals yet for {site.name}. The quickest way to add one is “Make this a goal” on a page's Clicks tab.</li>}
            {goals.map(goal => <GoalRow key={goal.id} goal={goal} onChanged={list.reload} />)}
          </ul>
        )}
        {list.data && !full && (
          <form className="goal-form" onSubmit={add}>
            <div className="seg" role="group" aria-label="Kind of goal">
              <button type="button" className={type === "click" ? "on" : ""} onClick={() => setType("click")}>Clicks a button or link</button>
              <button type="button" className={type === "page" ? "on" : ""} onClick={() => setType("page")}>Goes on to a page</button>
              <button type="button" className={type === "form" ? "on" : ""} onClick={() => setType("form")} disabled={!list.data.form_goals} title={list.data.form_goals ? undefined : "Included with Ultra"}>Sends a form{list.data.form_goals ? "" : " (Ultra)"}</button>
            </div>
            <div className="inline-form">
              {type === "click" ? (
                <input value={text} onChange={event => setText(event.target.value)} placeholder="Button or link text, like Start free trial" aria-label="Button or link text" maxLength={80} />
              ) : type === "form" ? (
                <select value={form} onChange={event => setForm(event.target.value)} aria-label="Form">
                  <option value="">{forms.data?.length === 0 ? "No forms sent in the last 30 days" : "Choose a form"}</option>
                  {(forms.data || []).map((f, i) => <option key={i} value={i}>{formLabel(f)} · sent {f.sent.toLocaleString()} times on {pageLabel(f.page)}</option>)}
                </select>
              ) : (
                <select value={target} onChange={event => setTarget(event.target.value)} aria-label="Page">
                  <option value="">Choose a page</option>
                  {(pages || []).map(p => <option key={p.page} value={p.page}>{pageLabel(p.page)}</option>)}
                </select>
              )}
              <input value={name} onChange={event => setName(event.target.value)} placeholder="Name (optional)" aria-label="Goal name" maxLength={60} />
              <button type="submit" className="btn primary" disabled={saving || !ready}>{saving ? "Adding…" : "Add goal"}</button>
            </div>
            {error && <p className="form-error">{error}</p>}
          </form>
        )}
        {full && <p className="muted">You've used every goal your plan includes for this website. Remove one to add another.</p>}
        <Wins />
      </div>
    </section>
  );
}
