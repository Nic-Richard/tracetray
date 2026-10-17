import { createRoot } from "react-dom/client";
import type { GoalTrend, Timeseries, UxTrends } from "@tracetray/shared";
import GoalTrendChart from "../../web/src/components/GoalTrendChart";
import TrendCharts from "../../web/src/components/TrendCharts";
import TrafficPanel from "../../web/src/components/TrafficPanel";
import "../../web/src/styles.css";
import "./surface.css";

const root = createRoot(document.getElementById("root")!);
const send = (value: object) => window.ReactNativeWebView?.postMessage(JSON.stringify(value));

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (value: string) => void };
    tracetrayRender: (props: { trends: UxTrends; goal: GoalTrend; visits: Timeseries; dark: boolean }) => void;
  }
}

window.tracetrayRender = ({ trends, goal, visits, dark }) => {
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  root.render(<main><TrafficPanel timeseries={visits} /><GoalTrendChart trend={goal} /><TrendCharts points={trends.points} /></main>);
};
new ResizeObserver(() => send({ type: "height", value: document.getElementById("root")!.scrollHeight })).observe(document.getElementById("root")!);
window.addEventListener("error", () => send({ type: "error" }));
send({ type: "ready" });
