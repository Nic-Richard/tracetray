import type { GoalTrend, Timeseries, UxTrends } from "@tracetray/shared";
import SharedSurface from "./SharedSurface";
import source from "../generated/trends.json";

export default function TrendSurface(data: { trends: UxTrends; goal: GoalTrend; visits: Timeseries }) {
  return <SharedSurface source={source} data={data} />;
}
