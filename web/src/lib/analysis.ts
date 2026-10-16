import type { AnalysisResult, ClusterStory, Device, DeviceAnalysis, Interpretation } from "@tracetray/shared";

export function interpretationOf(result: AnalysisResult | null | undefined): Interpretation | null {
  return result?.interpretation || result?.ai_interpretation || null;
}

export interface VisitorType {
  id: number;
  key?: string;
  share: number;
  sessions: number;
  story: ClusterStory | null;
  headline: string;
}

export function deviceAnalysis(result: AnalysisResult | null | undefined, device: Device): DeviceAnalysis | null {
  return (device === "mobile" ? result?.mobile : result) || null;
}

function groupedCount(source: DeviceAnalysis | null): number {
  return (source?.clusters || []).reduce((sum, c) => sum + (c.n || 0), 0);
}

/** Every visit on the device over the analyzed stretch, including those that never interacted. */
export function visitCount(result: AnalysisResult | null | undefined, device: Device): number {
  const source = deviceAnalysis(result, device);
  return groupedCount(source) + (source?.inactive_count || 0);
}

export function visitorTypes(result: AnalysisResult | null | undefined, device: Device): VisitorType[] {
  const source = deviceAnalysis(result, device);
  const total = visitCount(result, device) || 1;
  const interpretation = interpretationOf(result);
  const stories = (device === "mobile" ? interpretation?.mobile_cluster_stories : interpretation?.cluster_stories) || {};
  return [...(source?.clusters || [])]
    .sort((a, b) => b.n - a.n)
    .map(c => ({ id: c.id, key: stories[c.id]?.key, share: c.n / total, sessions: c.n, story: stories[c.id] || null, headline: stories[c.id]?.headline || c.label }));
}

export interface InactiveVisits {
  count: number;
  share: number;
  /** Their goal rate, when the groups are judged by a goal. */
  goal: { name: string; rate: number } | null;
}

export function inactiveVisits(result: AnalysisResult | null | undefined, device: Device): InactiveVisits | null {
  const source = deviceAnalysis(result, device);
  const count = source?.inactive_count || 0;
  if (!count) return null;
  const goal = result?.goal;
  const judged = Object.values((device === "mobile" ? interpretationOf(result)?.mobile_cluster_stories : interpretationOf(result)?.cluster_stories) || {}).some(s => s.goal);
  return {
    count,
    share: count / (visitCount(result, device) || 1),
    goal: goal && judged ? { name: goal.name, rate: (source?.inactive_goal_hits?.[goal.id] || 0) / count } : null
  };
}

export function alikeNote(result: AnalysisResult | null | undefined, device: Device): string | null {
  if (deviceAnalysis(result, device)?.structure !== "none") return null;
  return interpretationOf(result)?.alike?.[device] || "No split into groups held up for these visitors, so they're treated as one.";
}

export const INACTIVE_TEXT: Record<Device, string> = {
  desktop: "They left without moving the cursor, scrolling or clicking.",
  mobile: "They left without scrolling or tapping."
};
