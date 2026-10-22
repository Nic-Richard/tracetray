import type { AnalysisResult, ClusterStory, Device, DeviceAnalysis, Interpretation, Trait } from "./types";

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

/** The page's goal rate across every visit on the device, including those that never interacted. */
export function deviceGoal(result: AnalysisResult | null | undefined, device: Device): { name: string; rate: number } | null {
  const source = deviceAnalysis(result, device);
  const goal = result?.goal;
  const visits = visitCount(result, device);
  if (!goal || !source || !visits) return null;
  const reached = (source.clusters || []).reduce((sum, c) => sum + (c.goal_hits?.[goal.id] || 0), 0) + (source.inactive_goal_hits?.[goal.id] || 0);
  return { name: goal.name, rate: reached / visits };
}

export function deviceAverages(result: AnalysisResult | null | undefined, device: Device): { depth: number | null; actions: number | null } {
  const clusters = deviceAnalysis(result, device)?.clusters || [];
  const mean = (feature: string) => {
    const rows = clusters.filter(c => typeof c.feature_means[feature] === "number");
    const n = rows.reduce((sum, c) => sum + c.n, 0);
    return n ? rows.reduce((sum, c) => sum + (c.feature_means[feature] as number) * c.n, 0) / n : null;
  };
  return { depth: mean("scroll_depth_reached"), actions: mean(device === "mobile" ? "tap_rate" : "click_rate") };
}

export const INACTIVE_TEXT: Record<Device, string> = {
  desktop: "They left without moving the cursor, scrolling or clicking.",
  mobile: "They left without scrolling or tapping."
};

export function visitorIntro(result: AnalysisResult, device: Device, groups: number): string {
  const source = deviceAnalysis(result, device);
  if (!source?.session_count) return `No ${device} groups yet.`;
  const visits = visitCount(result, device);
  const inactive = source.inactive_count || 0;
  const lead = `${visits.toLocaleString()} ${device} visits`;
  const left = inactive ? `${inactive.toLocaleString()} left without interacting. ` : "";
  if (source.structure === "none") return `${lead}. ${left}${inactive ? "The rest" : "They"} behave much alike, so they're described as one.`;
  const sorted = `${inactive ? `The other ${source.session_count.toLocaleString()}` : "They"} are sorted into ${groups} groups by how people ${device === "mobile" ? "scrolled, paused and tapped" : "moved, paused, clicked and scrolled"}.`;
  const caution = source.session_count < MIN_ADVICE_VISITS
    ? " That's too few visits to suggest changes, so read the groups as early signs."
    : source.structure === "some" ? " The groups overlap, so read them as tendencies." : "";
  return `${lead}. ${left}${sorted}${caution}`;
}

/** Below this many analysed visits on a device, groups are shown as early signs and no changes are suggested. */
export const MIN_ADVICE_VISITS = 100;

export function analysisAdvice(result: AnalysisResult): NonNullable<Interpretation["advice"]> {
  return (interpretationOf(result)?.advice || []).filter(item => {
    const source = deviceAnalysis(result, item.device);
    return source?.clusters.length && source.structure !== "none" && source.session_count >= MIN_ADVICE_VISITS && item.action.trim() && item.evidence.trim();
  });
}

const perMinute = (value: number) => (value * 60).toFixed(1);
const seconds = (value: number) => `${(value / 1000).toFixed(1)} s`;
const percentage = (value: number) => `${(value * 100).toFixed(0)}%`;
const MEASURES: Record<string, { label: string; format: (value: number) => string }> = {
  pause_rate: { label: "Pauses a minute", format: perMinute },
  click_rate: { label: "Clicks a minute", format: perMinute },
  tap_rate: { label: "Taps a minute", format: perMinute },
  move_density: { label: "Cursor moves a second", format: value => value.toFixed(1) },
  avg_cursor_velocity: { label: "Cursor speed", format: value => `${value.toFixed(1)} px/ms` },
  dwell_before_click: { label: "Wait before clicking", format: seconds },
  dwell_before_tap: { label: "Wait before tapping", format: seconds },
  spatial_entropy: { label: "Cursor spread", format: value => percentage(value / Math.log2(9)) },
  top_zone_ratio: { label: "Cursor time in the top third", format: percentage },
  centre_zone_ratio: { label: "Cursor time in the middle third", format: percentage },
  bottom_zone_ratio: { label: "Cursor time in the bottom third", format: percentage },
  scroll_depth_reached: { label: "How far down", format: percentage },
  direction_change_rate: { label: "Scrolls back up a minute", format: perMinute },
  scroll_velocity_rate: { label: "Scroll speed", format: value => `${value.toFixed(2)} px/ms` },
  attention_pause_rate: { label: "Reading stops a minute", format: perMinute },
  avg_attention_pause_ms: { label: "Typical reading stop", format: seconds }
};

export function traitRows(traits: Trait[]) {
  return traits.filter(trait => MEASURES[trait.feature] && Number.isFinite(trait.value) && Number.isFinite(trait.page_average) && trait.value >= 0 && trait.page_average >= 0)
    .map(trait => {
      const measure = MEASURES[trait.feature];
      const top = Math.max(trait.value, trait.page_average) * 1.15 || 1;
      return {
        feature: trait.feature, label: measure.label, description: trait.description,
        value: measure.format(trait.value), average: measure.format(trait.page_average),
        valuePosition: trait.value / top, averagePosition: trait.page_average / top
      };
    });
}
export const MIN_ANALYSIS_VISITS = 16;
