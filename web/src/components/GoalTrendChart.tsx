import { useState } from "react";
import { percent, type GoalTrend } from "@tracetray/shared";

const rate = (value: number | null) => value === null ? "–" : percent(value, value < 0.1 ? 1 : 0);
const weekLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

export default function GoalTrendChart({ trend }: { trend: GoalTrend }) {
  const [selected, setSelected] = useState<string | null>(null);
  if (!trend.goal) return null;
  const { goal, weeks, best } = trend;
  const target = goal.target ?? null;
  const top = Math.max(target || 0, ...weeks.map(w => w.rate || 0)) || 1;
  const latest = [...weeks].reverse().find(w => w.rate !== null && w.visits > 0);
  const picked = weeks.find(week => week.week === selected);
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
            <button type="button" key={w.week} className={`goal-bar${best?.week === w.week ? " best" : ""}${i === weeks.length - 1 ? " current" : ""}`}
              style={{ height: `${w.rate ? Math.max(2, (w.rate / top) * 100) : 0}%` }}
              onClick={() => setSelected(w.week)} aria-pressed={selected === w.week}
              aria-label={`Week of ${weekLabel(w.week)}: ${rate(w.rate)}, ${w.reached.toLocaleString()} of ${w.visits.toLocaleString()} visits`}
              title={`Week of ${weekLabel(w.week)}: ${rate(w.rate)} (${w.reached.toLocaleString()} of ${w.visits.toLocaleString()} visits)${i === weeks.length - 1 ? ", so far" : ""}`} />
          ))}
        </div>
        <div className="goal-axis">
          {weeks.map((w, i) => <small key={w.week}>{i % 3 === 0 || i === weeks.length - 1 ? weekLabel(w.week) : ""}</small>)}
        </div>
        <p className="muted" aria-live="polite" style={{ marginTop: 12 }}>{picked ? `Week of ${weekLabel(picked.week)}: ${rate(picked.rate)} (${picked.reached.toLocaleString()} of ${picked.visits.toLocaleString()} visits).` : "Select a week to see its goal rate and visits."}</p>
      </div>
    </section>
  );
}
