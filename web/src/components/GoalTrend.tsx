import { useApi } from "../api";
import { useSite } from "../state/site";
import { useLoad } from "../lib/useLoad";
import GoalTrendChart from "./GoalTrendChart";

export default function GoalTrend({ page }: { page: string }) {
  const api = useApi();
  const { siteKey } = useSite();
  const trend = useLoad(() => api.goalTrend(siteKey, page), [api, siteKey, page]);
  return trend.data ? <GoalTrendChart trend={trend.data} /> : null;
}
