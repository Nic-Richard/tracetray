import type { GoalTrend, Timeseries, UxTrends } from "@tracetray/shared";
import GoalTrendChart from "../../web/src/components/GoalTrendChart";
import TrendCharts from "../../web/src/components/TrendCharts";
import TrafficPanel from "../../web/src/components/TrafficPanel";
import { mount } from "./bridge";

mount<{ trends: UxTrends; goal: GoalTrend; visits: Timeseries; dark: boolean }>(({ trends, goal, visits }) =>
  <main><TrafficPanel timeseries={visits} /><GoalTrendChart trend={goal} /><TrendCharts points={trends.points} /></main>
);
