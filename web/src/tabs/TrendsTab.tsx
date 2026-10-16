import { Line } from "react-chartjs-2";
import { CategoryScale, Chart, LinearScale, LineElement, PointElement, Tooltip } from "chart.js";
import { percent, type UxTrendPoint } from "@tracetray/shared";
import { useApi } from "../api";
import { useSite } from "../state/site";
import { useLoad } from "../lib/useLoad";
import { cssVar, useThemeVersion } from "../lib/palette";
import BeforeAfter from "../components/BeforeAfter";
import GoalTrend from "../components/GoalTrend";

Chart.register(CategoryScale, LinearScale, LineElement, PointElement, Tooltip);

interface Measure {
  key: keyof UxTrendPoint;
  title: string;
  explain: string;
  format: (value: number) => string;
  /** Which way is an improvement; null when either direction can be good. */
  better: "up" | "down" | null;
  color: string;
}

const MEASURES: Measure[] = [
  { key: "engaged", title: "Engaged visits", explain: "Stayed 10 seconds or more and scrolled, clicked or tapped", format: v => percent(v), better: "up", color: "--d2" },
  { key: "scroll_depth", title: "Scroll depth", explain: "How far down the page visitors get. Lower isn't always worse: they may find what they need sooner", format: v => percent(v), better: null, color: "--d1" },
  { key: "time_on_page_ms", title: "Time on page", explain: "Average visit length, with visits over 30 minutes counted as 30", format: v => v >= 60000 ? `${(v / 60000).toFixed(1)} min` : `${Math.round(v / 1000)} s`, better: null, color: "--d3" },
  { key: "actions_per_visit", title: "Clicks and taps", explain: "Per visit. More can mean interest, or visitors hunting for something", format: v => v.toFixed(1), better: null, color: "--d4" }
];

// A week needs this many visits before its numbers say much.
const MIN_WEEK_VISITS = 30;

const weekLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function MeasureCard({ measure, points, theme }: { measure: Measure; points: UxTrendPoint[]; theme: number }) {
  const series = points.filter(p => typeof p[measure.key] === "number");
  if (series.length === 0) {
    return <section className="panel trend"><div className="panel-head"><h2>{measure.title}</h2></div><p className="empty">Not measured on this page yet.</p></section>;
  }
  const latest = series[series.length - 1];
  const last = latest[measure.key] as number;
  const earlier = series.slice(0, -1).filter(p => p.visits >= MIN_WEEK_VISITS);
  const baseline = earlier.length ? earlier.reduce((sum, p) => sum + (p[measure.key] as number) * p.visits, 0) / earlier.reduce((sum, p) => sum + p.visits, 0) : null;
  const change = baseline ? (last - baseline) / baseline : 0;
  const judged = baseline !== null && latest.visits >= MIN_WEEK_VISITS;
  const moved = judged && Math.abs(change) > 0.05;
  const improved = moved && (measure.better === "up" ? change > 0 : measure.better === "down" && change < 0);
  const worse = moved && measure.better !== null && !improved;
  const color = cssVar(measure.color);
  const verdict = !judged ? null : improved ? "better" : worse ? "worse" : "same";
  const label = verdict === "better" ? "Better" : verdict === "worse" ? "Worse"
    : moved ? `${change > 0 ? "Up" : "Down"} ${Math.round(Math.abs(change) * 100)}%` : "About the same";

  return (
    <section className="panel trend">
      <div className="panel-head">
        <h2>{measure.title}</h2>
        <div className="end">
          {verdict && <span className={`verdict ${verdict}`}>{label}</span>}
          <b className="num trend-value" style={{ color }}>{measure.format(last)}</b>
        </div>
      </div>
      <div className="panel-body">
        <p className="muted">{measure.explain}.{baseline !== null && ` The weeks before averaged ${measure.format(baseline)}.`}</p>
        <div style={{ height: 150, marginTop: 12 }}>
          <Line
            key={theme}
            data={{
              labels: series.map(p => weekLabel(p.week_start)),
              datasets: [{ data: series.map(p => p[measure.key] as number), borderColor: color, backgroundColor: color, borderWidth: 3, pointRadius: 4, tension: 0.3 }]
            }}
            options={{
              maintainAspectRatio: false,
              animation: false,
              plugins: { legend: { display: false }, tooltip: { callbacks: { title: items => `Week from ${items[0]?.label}`, label: ctx => `${measure.format(ctx.parsed.y ?? 0)}, ${series[ctx.dataIndex].visits.toLocaleString()} visits` } } },
              scales: { x: { grid: { display: false }, ticks: { color: cssVar("--muted"), maxTicksLimit: 5, font: { size: 13 } } }, y: { display: false } }
            }}
          />
        </div>
      </div>
    </section>
  );
}

export default function TrendsTab({ page }: { page: string }) {
  const api = useApi();
  const { siteKey } = useSite();
  const trends = useLoad(() => api.uxTrends(siteKey, page, 8), [api, siteKey, page]);
  const theme = useThemeVersion();

  if (trends.error) return <div className="content"><p className="page-status error" style={{ padding: 0 }}>{trends.error}</p></div>;
  if (!trends.data) return <p className="loading">Loading…</p>;
  const points = trends.data.points;

  return (
    <div className="content">
      <GoalTrend page={page} />
      <BeforeAfter page={page} />
      <p className="tab-intro">Each point is one week of visits, starting Monday; the last is this week so far. It's compared with the weeks before it once it has {MIN_WEEK_VISITS} visits.</p>
      {points.every(p => !p.visits)
        ? <section className="panel"><p className="empty">No visits to this page in the last few weeks.</p></section>
        : <div className="trend-grid">{MEASURES.map(measure => <MeasureCard key={measure.key} measure={measure} points={points} theme={theme} />)}</div>}
    </div>
  );
}
