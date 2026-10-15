import { percent } from "@tracetray/shared";
import { useApi } from "../api";
import { useSite } from "../state/site";
import { useLoad } from "../lib/useLoad";

const rate = (value: number | null) => value === null ? "–" : percent(value, value < 0.1 ? 1 : 0);
const weekLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

/** Twelve weeks of the page's main goal rate, its best week and its target. */
export default function GoalTrend({ page }: { page: string }) {
  const api = useApi();
  const { siteKey } = useSite();
  const trend = useLoad(() => api.goalTrend(siteKey, page), [api, siteKey, page]);
  if (!trend.data?.goal) return null;

  const { goal, weeks, best } = trend.data;
  const target = goal.target ?? null;
  const top = Math.max(target || 0, ...weeks.map(w => w.rate || 0)) || 1;
  const latest = [...weeks].reverse().find(w => w.rate !== null && w.visits > 0);
  return (
    <section className="panel goal-trend">
      <div className="panel-head">
        <h2>Reached {goal.name}, week by week</h2>
        <div className="end"><span className="ask-note">Weeks start Monday</span></div>
      </div>
      <div className="panel-body">
        <p className="muted">
          {best ? <>Best week: <b>{rate(best.rate)}</b>, the week of {weekLabel(best.week)}.</> : "A best week shows once a full week has at least 30 visits."}
          {target !== null && latest?.rate != null && <> {latest.rate >= target ? "The latest week is at or above the target." : `The target is ${rate(target)}.`}</>}
        </p>
        <div className="goal-plot">
          {target !== null && <span className="goal-target-line" style={{ bottom: `${(target / top) * 100}%` }}><small>target {rate(target)}</small></span>}
          {weeks.map((w, i) => (
            <span key={w.week} className={`goal-bar${best?.week === w.week ? " best" : ""}${i === weeks.length - 1 ? " current" : ""}`}
              style={{ height: `${w.rate ? Math.max(2, (w.rate / top) * 100) : 0}%` }}
              title={`Week of ${weekLabel(w.week)}: ${rate(w.rate)} (${w.reached.toLocaleString()} of ${w.visits.toLocaleString()} visits)${i === weeks.length - 1 ? ", so far" : ""}`} />
          ))}
        </div>
        <div className="goal-axis">
          {weeks.map((w, i) => <small key={w.week}>{i % 3 === 0 || i === weeks.length - 1 ? weekLabel(w.week) : ""}</small>)}
        </div>
      </div>
    </section>
  );
}
