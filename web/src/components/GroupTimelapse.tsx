import { useApi } from "../api";
import { useSite } from "../state/site";
import { useLoad } from "../lib/useLoad";
import GroupTimelapseView from "./GroupTimelapseView";

export default function GroupTimelapse({ page }: { page: string }) {
  const api = useApi();
  const { siteKey } = useSite();
  const history = useLoad(() => api.groupHistory(siteKey, page), [api, siteKey, page]);
  return history.data ? <GroupTimelapseView history={history.data} /> : null;
}
