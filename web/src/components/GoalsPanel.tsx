import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "react-router";
import { pageLabel, type Goal, type GoalType } from "@tracetray/shared";
import { useApi } from "../api";
import { useSite } from "../state/site";
import { useLoad } from "../lib/useLoad";
import { describeGoal } from "./GoalLine";

function GoalRow({ goal, onChanged }: { goal: Goal; onChanged: () => void }) {
  const api = useApi();
  const { siteKey } = useSite();
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError("");
    try {
      await action();
      setName(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  }

  const checking = goal.backfill === "queued" || goal.backfill === "running";
  return (
    <li className="goal-row">
      {name === null ? (
        <span>
          <b>{goal.name}</b>
          <small>{describeGoal(goal)}</small>
          <small>{checking ? "Checking past visits…" : goal.backfill === "failed" ? "Couldn't check past visits; new visits still count." : goal.reached_last_7_days ? `Reached ${goal.reached_last_7_days.toLocaleString()} times in the last 7 days` : "No matches in the last 7 days"}</small>
        </span>
      ) : (
        <form className="inline-form" onSubmit={event => { event.preventDefault(); run(() => api.editGoal(siteKey, goal.id, { name })); }}>
          <input value={name} onChange={event => setName(event.target.value)} aria-label="Goal name" maxLength={60} autoFocus />
          <button type="submit" className="btn" disabled={busy || !name.trim()}>Save</button>
          <button type="button" className="link-button" onClick={() => setName(null)}>Cancel</button>
        </form>
      )}
      {name === null && (
        <span className="row-actions">
          <button type="button" className="link-button" onClick={() => setName(goal.name)} disabled={busy}>Rename</button>
          <button type="button" className="link-button danger" onClick={() => run(() => api.removeGoal(siteKey, goal.id))} disabled={busy}>Remove</button>
        </span>
      )}
      {error && <p className="form-error">{error}</p>}
    </li>
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
      const match = type === "click" ? { text } : { page: target };
      await api.addGoal(siteKey, { name: name || (type === "click" ? text : pageLabel(target)), type, match });
      setName(""); setText(""); setTarget("");
      list.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The goal wasn't saved");
    } finally {
      setSaving(false);
    }
  }

  const goals = list.data?.goals || [];
  const full = list.data ? goals.length >= list.data.cap : false;
  const ready = type === "click" ? text.trim() : target;
  return (
    <section className="panel" id="goals">
      <div className="panel-head">
        <h2>Goals</h2>
        {list.data && <div className="end"><span className="ask-note">{goals.length} of {list.data.cap}</span></div>}
      </div>
      <div className="panel-body setup-copy">
        <p>A goal is what a page is for: a button or link people click, or a page they go on to, like checkout or a thank-you page. Each page then shows how many visits reached it, and new goals are checked against past visits too.</p>
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
            </div>
            <div className="inline-form">
              {type === "click" ? (
                <input value={text} onChange={event => setText(event.target.value)} placeholder="Button or link text, like Start free trial" aria-label="Button or link text" maxLength={80} />
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
      </div>
    </section>
  );
}
