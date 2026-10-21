import { MIN_ANALYSIS_VISITS as MIN_SESSIONS, pageLabel, type Api } from "@tracetray/shared";

export async function refreshAnalysis(
  api: Api,
  site: string,
  page: string,
  scope: "page" | "all",
  progress: (message: string) => void,
  active = () => true,
) {
  const pages =
    scope === "all"
      ? (await api.pages(site))
          .filter(value => !value.locked && value.analysable >= MIN_SESSIONS)
          .map(value => value.page)
      : [page];
  if (!pages.length) return `No page has ${MIN_SESSIONS} visits with movement, clicks or scrolling yet.`;
  if (!active()) return null;
  const permit = await api.analysisPermit(site, scope, pages.length);
  let incomplete = 0;
  for (const [index, target] of pages.entries()) {
    if (!active()) return null;
    progress(scope === "all" ? `Analyzing ${index + 1} of ${pages.length}: ${pageLabel(target)}` : "Analyzing visits…");
    const run = await api.runAnalysis(site, permit.permit_token, target);
    if (run.result.failure) {
      incomplete++;
      if (scope === "page")
        return (
          run.result.failure.message ||
          `Not enough visits to sort into groups yet (${run.result.failure.have ?? 0} of ${run.result.failure.needed ?? MIN_SESSIONS} needed).`
        );
    }
  }
  return scope === "all"
    ? `Refreshed ${pages.length} page${pages.length === 1 ? "" : "s"}.${incomplete ? ` ${incomplete} couldn't be grouped yet.` : ""}`
    : `Updated. ${permit.remaining_free_today} more refresh${permit.remaining_free_today === 1 ? "" : "es"} for this site today.`;
}
