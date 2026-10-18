import { useState } from "react";
import { Link, useLocation } from "react-router";
import { describeGoal, percent } from "@tracetray/shared";
import { useApi } from "../api";
import { useSite } from "../state/site";
import { useLoad } from "../lib/useLoad";

/** The page's goal rate under the page title, or a way to set one. */
export default function GoalLine({ page }: { page: string }) {
  const api = useApi();
  const { siteKey } = useSite();
  const { search } = useLocation();
  const rates = useLoad(() => api.goalRates(siteKey, page, 30), [api, siteKey, page]);
  const [saving, setSaving] = useState(false);

  if (rates.error || !rates.data) return null;
  const goals = rates.data.goals;
  if (!goals.length) {
    return (
      <p className="goal-line empty-goal">
        No goal for this page yet: <Link to={{ pathname: "/pages/clicks", search }}>pick a button on Clicks</Link>, or <Link to={{ pathname: "/setup", search, hash: "#goals" }}>set one in Setup</Link>.
      </p>
    );
  }

  const goal = goals[0];
  async function choose(id: string) {
    setSaving(true);
    try {
      await api.setMainGoal(siteKey, page, id);
      rates.reload();
    } finally {
      setSaving(false);
    }
  }

  const checking = goal.backfill === "queued" || goal.backfill === "running";
  return (
    <div className="goal-line">
      <span className="goal-rate num">{goal.rate === null ? "–" : percent(goal.rate, goal.rate < 0.1 ? 1 : 0)}</span>
      <span className="goal-what">
        <b>{goals.length > 1 ? (
          <select value={goal.id} onChange={event => choose(event.target.value)} disabled={saving} aria-label="Goal shown for this page">
            {goals.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        ) : goal.name}</b>
        <small>
          {checking ? "Checking past visits…" : `${goal.reached.toLocaleString()} of ${goal.visits.toLocaleString()} visits reached it in the last 30 days`}<span className="sep" aria-hidden="true">·</span>{describeGoal(goal)}
        </small>
      </span>
      {goal.target != null && goal.rate !== null && (
        goal.rate >= goal.target
          ? <span className="goal-progress met">Target of {percent(goal.target, goal.target < 0.1 ? 1 : 0)} reached</span>
          : <span className="goal-progress">
              <span className="meter" aria-hidden="true"><i style={{ width: `${(goal.rate / goal.target) * 100}%`, background: "var(--good)" }} /></span>
              {Math.round((goal.rate / goal.target) * 100)}% of the way to {percent(goal.target, goal.target < 0.1 ? 1 : 0)}
            </span>
      )}
    </div>
  );
}
