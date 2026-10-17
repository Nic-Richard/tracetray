import type { AnalysisResult } from "@tracetray/shared";
import { useApi } from "../api";
import { useSite } from "../state/site";
import { useLoad } from "../lib/useLoad";
import { usePageShot } from "../lib/usePageShot";
import AttentionContent from "../components/AttentionContent";

export default function AttentionTab({ page, result }: { page: string; result: AnalysisResult | null }) {
  const api = useApi();
  const { siteKey } = useSite();
  const profile = useLoad(() => api.attention(siteKey, page), [api, siteKey, page]);
  const desktopShot = usePageShot(page, "desktop", profile.data?.shots?.desktop);
  const phoneShot = usePageShot(page, "mobile", profile.data?.shots?.mobile);
  if (profile.error) return <div className="content"><p className="page-status error" style={{ padding: 0 }}>{profile.error}</p></div>;
  if (!profile.data) return <p className="loading">Loading?</p>;
  return <AttentionContent data={profile.data} result={result} desktopShot={desktopShot} phoneShot={phoneShot} />;
}
