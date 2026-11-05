import type { Device } from "./types";

export interface GroupShift {
  id: number;
  key: string | null;
  headline: string;
  /** Share of the device's grouped visits in each time bin, with a 95% interval. */
  shares: number[];
  low: number[];
  high: number[];
  /** Only set when it held up after correcting for the number of groups tested. */
  event: "appeared" | "faded" | "grew" | "shrank" | null;
  /** For a group that grew or shrank, its share before and after the change; otherwise the first and last third of the window. */
  from: number;
  to: number;
  /** When the change happened: a group's first sighting, last sighting, or where its share changed; epoch ms. */
  since?: number;
  drift: { feature: string; before: number; after: number; change: number }[];
}

/** Visits projected from the clustering space onto its first two principal components, both axes on one scale
 * in [-1, 1]: closer together means behaving more alike. One frame per time bin. */
export interface GroupMap {
  /** Share of the differences between visits that the two dimensions keep. */
  explained: number;
  /** Share of the differences each of the two directions keeps. */
  components?: [number, number];
  /** Correlation of each measure with the two directions. */
  loadings?: Record<string, [number, number]>;
  /** Where the average visit sits on the map. */
  origin?: [number, number];
  /** Where most visits fall: [x low, x high, y low, y high]. */
  extent?: [number, number, number, number];
  frames: { points: [number, number, number][]; centres: Record<string, [number, number]> }[];
}

export interface DeviceShifts {
  structure: string;
  bin_weeks: number;
  bins: { from: number; to: number; visits: number }[];
  groups: GroupShift[];
  map?: GroupMap | null;
  /** How the groups were chosen and checked, from the same analysis. */
  method?: {
    k: number; silhouette: number | null; stability: number | null; agreement: number | null;
    null_silhouette: number | null; null_silhouette_max: number | null; k_range: number[]; silhouettes: number[];
    goal_informed: boolean | null; visits: number | null; effects: { feature: string; effect: number; p: number | null }[];
  };
}

export interface GroupShifts {
  ran_at: string | null;
  desktop: DeviceShifts | null;
  mobile: DeviceShifts | null;
}

const MEASURES: Record<string, string> = {
  pause_rate: "pause",
  click_rate: "click",
  move_density: "move the cursor",
  distance_per_move: "move the cursor in long sweeps",
  avg_cursor_velocity: "move the cursor quickly",
  dwell_before_click: "wait before clicking",
  spatial_entropy: "move around the page",
  top_zone_ratio: "stay near the top",
  bottom_zone_ratio: "spend time near the bottom",
  scroll_depth_reached: "get far down the page",
  direction_change_rate: "scroll back up",
  scroll_burst_rate: "scroll in separate bursts",
  tap_rate: "tap",
  scroll_velocity_rate: "scroll quickly",
  attention_pause_rate: "stop to read",
  avg_attention_pause_ms: "stop to read for long",
  dwell_before_tap: "wait before tapping"
};

const pct = (v: number) => `${Math.round(v * 100)}%`;
const day = (ms: number) => new Date(ms).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
function amount(change: number): string {
  const size = Math.abs(change), more = change > 0;
  if (size >= 0.95) return more ? "about twice as much as" : "far less than";
  if (size >= 0.6) return more ? "much more than" : "much less than";
  if (size >= 0.3) return `about a ${size >= 0.45 ? "half" : "third"} ${more ? "more" : "less"} than`;
  return more ? "a little more than" : "a little less than";
}

/** Plain sentences on what changed, the clearest first; empty when nothing held up. */
export function shiftSentences(shifts: DeviceShifts | null, device: Device): string[] {
  if (!shifts) return [];
  const out: string[] = [];
  const firstWeek = day(shifts.bins[0].from);
  // With two groups, one growing is the other shrinking: say it once.
  const groups = shifts.groups.length === 2 && shifts.groups.every(g => g.event === "grew" || g.event === "shrank")
    ? shifts.groups.filter(g => g.event === "grew") : shifts.groups;
  for (const g of groups) {
    if (g.event === "appeared") out.push(`New: ${g.headline}, first seen around ${day(g.since!)}, now ${pct(g.to)} of ${device} visits.`);
    if (g.event === "faded") out.push(`${g.headline} faded out after ${day(g.since!)}: ${pct(g.from)} of ${device} visits early on, ${pct(g.to)} lately.`);
    if (g.event === "grew" || g.event === "shrank") out.push(`${g.headline} have averaged ${pct(g.to)} of ${device} visits since around ${day(g.since!)}, ${g.event === "grew" ? "up" : "down"} from ${pct(g.from)} before.`);
  }
  for (const g of shifts.groups) for (const d of g.drift) {
    const what = MEASURES[d.feature];
    if (what) out.push(`${g.headline} now ${what} ${amount(d.change)} they did around ${firstWeek}.`);
  }
  return out;
}

const NOUNS: Record<string, string> = {
  pause_rate: "pausing",
  click_rate: "clicking",
  move_density: "cursor movement",
  distance_per_move: "long cursor sweeps",
  avg_cursor_velocity: "fast cursor movement",
  dwell_before_click: "waiting before clicking",
  spatial_entropy: "moving around the page",
  top_zone_ratio: "time near the top",
  bottom_zone_ratio: "time near the bottom",
  centre_zone_ratio: "time in the middle",
  scroll_depth_reached: "scrolling further down",
  direction_change_rate: "scrolling back up",
  scroll_burst_rate: "scrolling in bursts",
  tap_rate: "tapping",
  scroll_velocity_rate: "fast scrolling",
  attention_pause_rate: "stopping to read",
  avg_attention_pause_ms: "long stops to read",
  dwell_before_tap: "waiting before tapping"
};

export const measureName = (feature: string) => NOUNS[feature] || feature.replace(/_/g, " ");

// A direction is only named after a measure that moves with it fairly strongly (a correlation of 0.4 or more).
const NAMED = 0.4;

/** What each end of the map's two directions means, in words: the measure that leans most that way, or null. */
export function mapDirections(map: GroupMap): { right: string | null; left: string | null; up: string | null; down: string | null } {
  const rows = Object.entries(map.loadings || {});
  const end = (axis: 0 | 1, sign: 1 | -1) => {
    const best = rows.filter(([, l]) => sign * l[axis] >= NAMED).sort((a, b) => sign * b[1][axis] - sign * a[1][axis])[0];
    return best ? `more ${measureName(best[0])}` : null;
  };
  return { right: end(0, 1), left: end(0, -1), up: end(1, 1), down: end(1, -1) };
}
