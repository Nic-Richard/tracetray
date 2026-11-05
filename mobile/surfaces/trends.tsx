import type { GoalTrend, GroupShifts, Timeseries, UxTrends } from "@tracetray/shared";
import GoalTrendChart from "../../web/src/components/GoalTrendChart";
import GroupShiftsView from "../../web/src/components/GroupShiftsView";
import TrendCharts from "../../web/src/components/TrendCharts";
import TrafficPanel from "../../web/src/components/TrafficPanel";
import { mount } from "./bridge";

mount<{ trends: UxTrends; goal: GoalTrend; visits: Timeseries; shifts: GroupShifts; dark: boolean }>(({ trends, goal, visits, shifts }) =>
  <main><TrafficPanel timeseries={visits} /><GoalTrendChart trend={goal} /><GroupShiftsView shifts={shifts} /><TrendCharts points={trends.points} /></main>
);
