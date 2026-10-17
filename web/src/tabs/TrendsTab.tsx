import { useApi } from "../api";
import { useSite } from "../state/site";
import { useLoad } from "../lib/useLoad";
import BeforeAfter from "../components/BeforeAfter";
import GoalTrend from "../components/GoalTrend";
import TrendCharts from "../components/TrendCharts";

export default function TrendsTab({ page }: { page: string }) {
  const api = useApi();
  const { siteKey } = useSite();
  const trends = useLoad(() => api.uxTrends(siteKey, page, 8), [api, siteKey, page]);
  if (trends.error) return <div className="content"><p className="page-status error" style={{ padding: 0 }}>{trends.error}</p></div>;
  if (!trends.data) return <p className="loading">Loading?</p>;
  return <div className="content">
    <GoalTrend page={page} />
    <BeforeAfter page={page} />
    <TrendCharts points={trends.data.points} />
  </div>;
}
