import { Line } from "react-chartjs-2";
import { CategoryScale, Chart, LinearScale, LineElement, PointElement, Tooltip } from "chart.js";
import { percent, type UxTrendPoint } from "@tracetray/shared";
import { useApi } from "../api";
import { useSite } from "../state/site";
import { useLoad } from "../lib/useLoad";

Chart.register(CategoryScale, LinearScale, LineElement, PointElement, Tooltip);

interface Measure {
  key: keyof UxTrendPoint;
  title: string;
  explain: string;
  format: (value: number) => string;
  better: "up" | "down";
}

const MEASURES: Measure[] = [
  { key: "hesitation_ms", title: "Hesitation", explain: "Wait before clicking or tapping", format: v => `${(v / 1000).toFixed(2)} s`, better: "down" },
  { key: "scroll_depth", title: "Scroll depth", explain: "How far down the page visitors get", format: v => percent(v), better: "up" },
  { key: "reading_pauses", title: "Reading pauses", explain: "Pauses per second while engaged", format: v => v.toFixed(2), better: "up" },
  { key: "ctr", title: "Top element clicks", explain: "Share of visits that click the most clicked element", format: v => percent(v), better: "up" }
];

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function MeasureCard({ measure, points }: { measure: Measure; points: UxTrendPoint[] }) {
  const series = points.filter(p => typeof p[measure.key] === "number");
  if (series.length === 0) {
    return <section className="panel trend"><div className="panel-head"><h2>{measure.title}</h2></div><p className="empty">Not measured on this page yet.</p></section>;
  }
  const first = series[0][measure.key] as number;
  const last = series[series.length - 1][measure.key] as number;
  const change = first ? (last - first) / first : 0;
  const improved = measure.better === "up" ? change > 0.02 : change < -0.02;
  const worse = measure.better === "up" ? change < -0.02 : change > 0.02;
  const ink = cssVar("--type-1");

  return (
    <section className="panel trend">
      <div className="panel-head">
        <h2>{measure.title}</h2>
        <div className="end"><b className="num">{measure.format(last)}</b></div>
      </div>
      <div className="panel-body">
        <p className="muted">{measure.explain}.{series.length > 1 && ` ${improved ? "Better" : worse ? "Worse" : "About the same"} than the first of these ${series.length} runs (${measure.format(first)}).`}</p>
        <div style={{ height: 120, marginTop: 10 }}>
          <Line
            data={{
              labels: series.map(p => new Date(p.ran_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })),
              datasets: [{ data: series.map(p => p[measure.key] as number), borderColor: ink, backgroundColor: ink, pointRadius: 3, tension: 0.25 }]
            }}
            options={{
              maintainAspectRatio: false,
              animation: false,
              plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => measure.format(ctx.parsed.y ?? 0) } } },
              scales: { x: { grid: { display: false }, ticks: { color: cssVar("--muted"), maxTicksLimit: 5 } }, y: { display: false } }
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
  const trends = useLoad(() => api.uxTrends(siteKey, page, 10), [api, siteKey, page]);

  if (trends.error) return <div className="content"><p className="page-status error" style={{ padding: 0 }}>{trends.error}</p></div>;
  if (!trends.data) return <p className="loading">Loading…</p>;
  const points = trends.data.points;

  return (
    <div className="content">
      <p className="tab-intro">Each point is one analysis run, not one day. Refresh the analysis after you change the page to see whether visitors behave differently.</p>
      {points.length === 0
        ? <section className="panel"><p className="empty">No analysis runs on this page yet.</p></section>
        : <div className="trend-grid">{MEASURES.map(measure => <MeasureCard key={measure.key} measure={measure} points={points} />)}</div>}
    </div>
  );
}
