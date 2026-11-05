import { useApi } from "../api";
import { useSite } from "../state/site";
import { useLoad } from "../lib/useLoad";
import GroupShiftsView from "./GroupShiftsView";

export default function GroupShifts({ page }: { page: string }) {
  const api = useApi();
  const { siteKey } = useSite();
  const shifts = useLoad(() => api.groupShifts(siteKey, page), [api, siteKey, page]);
  return shifts.data ? <GroupShiftsView shifts={shifts.data} /> : null;
}
