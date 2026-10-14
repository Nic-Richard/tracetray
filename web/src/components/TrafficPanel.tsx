import { Bar } from "react-chartjs-2";
import { BarElement, CategoryScale, Chart, LinearScale, Tooltip } from "chart.js";
import type { Timeseries } from "@tracetray/shared";

Chart.register(BarElement, CategoryScale, LinearScale, Tooltip);

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export default function TrafficPanel({ timeseries }: { timeseries: Timeseries }) {
  const labels = timeseries.series.map(day => new Date(`${day.date}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }));
  const ink = cssVar("--type-1");
  const soft = cssVar("--type-4");
  const muted = cssVar("--muted");
  const line = cssVar("--line");

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Visits by day</h2>
        <div className="end legend">
          <span><i style={{ background: ink }} />Desktop</span>
          <span><i style={{ background: soft }} />Mobile</span>
        </div>
      </div>
      <div className="panel-body" style={{ height: 240 }}>
        <Bar
          data={{
            labels,
            datasets: [
              { label: "Desktop", data: timeseries.series.map(d => d.desktop), backgroundColor: ink, borderRadius: 3, stack: "visits" },
              { label: "Mobile", data: timeseries.series.map(d => d.mobile), backgroundColor: soft, borderRadius: 3, stack: "visits" }
            ]
          }}
          options={{
            maintainAspectRatio: false,
            animation: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { stacked: true, grid: { display: false }, ticks: { color: muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
              y: { stacked: true, beginAtZero: true, grid: { color: line }, ticks: { color: muted, precision: 0 } }
            }
          }}
        />
      </div>
    </section>
  );
}
