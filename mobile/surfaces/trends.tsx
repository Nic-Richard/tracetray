import type { GoalTrend, GroupHistoryFrame, Timeseries, UxTrends } from "@tracetray/shared";
import GoalTrendChart from "../../web/src/components/GoalTrendChart";
import GroupTimelapseView from "../../web/src/components/GroupTimelapseView";
import TrendCharts from "../../web/src/components/TrendCharts";
import TrafficPanel from "../../web/src/components/TrafficPanel";
import { mount } from "./bridge";

mount<{ trends: UxTrends; goal: GoalTrend; visits: Timeseries; history: GroupHistoryFrame[]; dark: boolean }>(({ trends, goal, visits, history }) =>
  <main><TrafficPanel timeseries={visits} /><GoalTrendChart trend={goal} /><GroupTimelapseView history={history} /><TrendCharts points={trends.points} /></main>
);
