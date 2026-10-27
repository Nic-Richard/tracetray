import type { GoalTrend, GroupHistoryFrame, Timeseries, UxTrends } from "@tracetray/shared";
import SharedSurface from "./SharedSurface";
import source from "../generated/trends.json";

export default function TrendSurface(data: { trends: UxTrends; goal: GoalTrend; visits: Timeseries; history: GroupHistoryFrame[] }) {
  return <SharedSurface source={source} data={data} />;
}
