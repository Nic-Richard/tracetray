import type { AnalysisResult, ChangeFinding, Cluster, ClusterStory, Device, DeviceAnalysis, GoalPatterns, Interpretation, Trait } from "./types";

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
  /** "New" or "Since Oct 5"; empty on a page's first tracked analysis. */
  age: string | null;
  /** "Growing since Oct 8" and the like, only when the change held up. */
  trend: { text: string; up: boolean } | null;
  /** Within the group, what goes with reaching the goal, when it held up: the short line and the full sentence. */
  lever: { short: string; full: string } | null;
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
    .map(c => ({ id: c.id, key: stories[c.id]?.key, share: c.n / total, sessions: c.n, story: stories[c.id] || null, headline: stories[c.id]?.headline || c.label,
      age: groupAge(c.track, result?.ran_at), trend: groupTrend(source?.shifts?.groups[c.id]), lever: groupLever(source?.goal_patterns, c.id) }));
}

const shortDay = (ms: number) => new Date(ms).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });

function groupTrend(shift: NonNullable<NonNullable<DeviceAnalysis["shifts"]>["groups"][string]> | undefined): VisitorType["trend"] {
  if (!shift?.event || !shift.since) return null;
  if (shift.event === "appeared") return { text: `New since ${shortDay(shift.since)}`, up: true };
  if (shift.event === "faded") return { text: `Fading since ${shortDay(shift.since)}`, up: false };
  // With several steps, the latest one is what's true now.
  const steps = shift.steps;
  const last = steps && steps.length > 2 ? steps[steps.length - 1] : null;
  const up = last ? last.share > steps![steps!.length - 2].share : shift.event === "grew";
  return { text: `${up ? "Growing" : "Shrinking"} since ${shortDay(last ? last.since : shift.since)}`, up };
}

function groupLever(found: GoalPatterns | null | undefined, id: number): VisitorType["lever"] {
  const lever = found?.levers?.[id];
  if (!lever) return null;
  const rate = (side: { visits: number; reached: number }) => percentage(side.reached / side.visits);
  return {
    short: `${lever.fact} → ${rate(lever.with)} vs ${rate(lever.without)}`,
    full: `Those who ${lever.fact.charAt(0).toLowerCase()}${lever.fact.slice(1)}: ${rate(lever.with)} reached ${found!.goal}, against ${rate(lever.without)} of the rest of the group`
  };
}

function groupAge(track: Cluster["track"], ranAt: string | undefined): string | null {
  if (!track) return null;
  if (track.new) return "New";
  const since = Date.parse(track.since);
  if (!Number.isFinite(since) || !ranAt || since >= Date.parse(ranAt) - 86400000) return null;
  return `Since ${new Date(since).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
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
  return "No reliable groups found. These measures describe the visits together; this doesn't establish that everyone behaves alike.";
}

function scopeDate(value: string): string | null {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }) : null;
}

export function analysisPeriod(result: AnalysisResult, device: Device): string {
  return scopePeriod(deviceAnalysis(result, device)?.scope);
}

function scopePeriod(scope: DeviceAnalysis["scope"]): string {
  const from = scope && scopeDate(scope.from), to = scope && scopeDate(scope.to);
  return from && to ? `${from} to ${to} (UTC)` : "Dates weren't saved for this analysis";
}

export function analysisScope(result: AnalysisResult, device: Device): string {
  return measuredScope(deviceAnalysis(result, device), device);
}

export function findingScope(finding: ChangeFinding): string {
  return [measuredScope(finding, finding.device), ...(finding.related_scopes || []).map(source => measuredScope(source, source.device))].join(" ");
}

function measuredScope(source: Pick<DeviceAnalysis, "scope" | "session_count" | "inactive_count"> | null, device: Device): string {
  const scope = source?.scope;
  const parts = [`${(source?.session_count || 0).toLocaleString()} ${device} visits with recorded interaction. ${scopePeriod(scope)}.`];
  parts.push(source?.inactive_count == null ? "Visits without recorded interaction are excluded from grouping; their count wasn't saved."
    : `${source.inactive_count.toLocaleString()} visits without recorded interaction excluded from grouping, included in overall goal rates and group shares.`);
  if (scope) {
    parts.push(`${scope.excluded_detail.toLocaleString()} visits without full detail and ${scope.excluded_events.toLocaleString()} without recorded events excluded.`);
    parts.push(scope.at_limit ? `Sample limited to the latest ${scope.limit.toLocaleString()} interacting visits; earlier visits are excluded.` : `Uses available visits within the ${scope.window_days}-day analysis window.`);
  } else {
    parts.push("Other exclusion counts weren't saved.");
  }
  return parts.join(" ");
}

export function groupCountNote(result: AnalysisResult, device: Device): string | null {
  const source = deviceAnalysis(result, device);
  if (!result.goal || !source?.clusters.length || source.structure === "none" || source.k_rationale?.goal_informed === false) return null;
  return goalSelectionNote(source.k_rationale?.goal_informed);
}

export function findingGroupNote(finding: ChangeFinding): string | null {
  return finding.goal_informed === false ? null : goalSelectionNote(finding.goal_informed);
}

function goalSelectionNote(informed: unknown): string {
  return informed === true
    ? "Goal outcomes helped choose the group count. Differences in goal rates are exploratory and haven't been confirmed on later visits."
    : "This saved analysis doesn't record whether the goal helped choose the group count. Differences in goal rates haven't been confirmed on later visits.";
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
  if (source.structure === "none") return `${lead}. ${left}No reliable groups found among the visits with recorded interaction.`;
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
  attention_pause_rate: { label: "Scroll pauses a minute", format: perMinute },
  avg_attention_pause_ms: { label: "Typical scroll pause", format: seconds }
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

// How each measure reads in a sentence, for visits above and below the median. `none` and `some` replace them when
/** Plain sentences on what visits that reached the page's goal did differently, before reaching it: clicks, parts of
 * the page reached, read or returned to, and where they came from. Null when nothing held up. */
export function goalDrivers(result: AnalysisResult | null | undefined, device: Device): { intro: string | null; lines: string[] } | null {
  const found = deviceAnalysis(result, device)?.goal_patterns;
  if (!found?.patterns.length) return null;
  const rate = (side: { visits: number; reached: number }) => percentage(side.reached / side.visits);
  const lines = found.patterns.map(p => `${p.fact}: ${rate(p.with)} reached ${found.goal} (${p.with.visits.toLocaleString()} visits), against ${rate(p.without)} for the rest.${p.holds ? "" : " Mostly explained by those visits being longer."}`);
  return { intro: `${found.visits.toLocaleString()} ${device} visits, ${found.reached.toLocaleString()} reached ${found.goal}. Only what happened before reaching it counts. ${found.tried ? `${found.tried} patterns were checked; these held up after allowing for that.` : ""}`.trim(), lines };
}
