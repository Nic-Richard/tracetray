import { Bar } from "react-chartjs-2";
import { BarElement, CategoryScale, Chart, LinearScale, Tooltip } from "chart.js";
import type { Timeseries } from "@tracetray/shared";
import { cssVar, useThemeVersion } from "../lib/palette";

Chart.register(BarElement, CategoryScale, LinearScale, Tooltip);

export default function TrafficPanel({ timeseries }: { timeseries: Timeseries }) {
  const theme = useThemeVersion();
  const labels = timeseries.series.map(day => new Date(`${day.date}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }));
  const desktop = cssVar("--desktop");
  const mobile = cssVar("--mobile");
  const muted = cssVar("--muted");
  const line = cssVar("--line");

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Visits by day</h2>
        <div className="end legend">
          <span><i style={{ background: desktop }} />Desktop</span>
          <span><i style={{ background: mobile }} />Mobile</span>
        </div>
      </div>
      <div className="panel-body" style={{ height: 300 }}>
        <Bar
          key={theme}
          data={{
            labels,
            datasets: [
              { label: "Desktop", data: timeseries.series.map(d => d.desktop), backgroundColor: desktop, borderRadius: 4, stack: "visits" },
              { label: "Mobile", data: timeseries.series.map(d => d.mobile), backgroundColor: mobile, borderRadius: 4, stack: "visits" }
            ]
          }}
          options={{
            maintainAspectRatio: false,
            animation: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { stacked: true, grid: { display: false }, ticks: { color: muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 10, font: { size: 13 } } },
              y: { stacked: true, beginAtZero: true, grid: { color: line }, ticks: { color: muted, precision: 0, font: { size: 13 } } }
            }
          }}
        />
      </div>
    </section>
  );
}
