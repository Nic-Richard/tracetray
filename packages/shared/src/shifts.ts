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
  /** When the share changed more than once, its level in each stretch, oldest first. */
  steps?: { since: number; share: number }[];
  /** Measured across the group's change (from `since`) when it has one, otherwise early against recent visits. */
  drift: { feature: string; before: number; after: number; change: number; since?: number }[];
  /** For a group that changed: how much came from where visitors come from changing (traffic) and how much from
   * the group growing or shrinking within sources; a driver is named only when the traffic part held up. */
  sources?: { change: number; traffic: Band; within: Band; drivers: { source: string; part: number; traffic_before: number; traffic_after: number }[] };
}

/** [estimate, 95% low, 95% high]. */
export type Band = [number, number, number];

/** The goal rate's change at the main shift, split exactly into who's visiting (mix) and how each group behaves. */
export interface GoalImpact {
  since: number;
  rate_before: number;
  rate_after: number;
  total: Band;
  mix: Band;
  behaviour: Band;
  groups: { id: number; share_before: number; share_after: number; rate_before: number; rate_after: number }[];
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
  impact?: GoalImpact | null;
  /** How the groups were chosen and checked, from the same analysis. */
  method?: {
    k: number; silhouette: number | null; stability: number | null; agreement: number | null;
    null_silhouette: number | null; null_silhouette_max: number | null; k_range: number[]; silhouettes: number[];
    goal_informed: boolean | null; visits: number | null; effects: { feature: string; effect: number; p: number | null }[];
  };
}

export interface GroupShifts {
  ran_at: string | null;
  /** The page's goal, when it has one. */
  goal?: string | null;
  /** Changes recorded for this page in Before and after. */
  changes?: { day: string; note: string | null }[];
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

const real = (band: Band) => band[1] > 0 || band[2] < 0;
const points = (v: number) => `${Math.abs(v * 100).toFixed(1)} point${Math.abs(v * 100).toFixed(1) === "1.0" ? "" : "s"}`;
const DAY_MS = 24 * 60 * 60 * 1000;

// A shift and a recorded change this close together are worth pointing out; nothing more is claimed.
function nearChange(at: number, changes: { day: string; note: string | null }[]): string {
  const near = changes.map(c => ({ c, gap: Math.abs(Date.parse(`${c.day}T00:00:00Z`) - at) })).filter(x => x.gap <= 7 * DAY_MS).sort((a, b) => a.gap - b.gap)[0];
  return near ? `, close to your change${near.c.note ? ` “${near.c.note}”` : ""} on ${day(Date.parse(`${near.c.day}T00:00:00Z`))}` : "";
}

// The group whose share moved most, and whether it reaches the goal more or less often than everyone else did.
function mainMover(impact: GoalImpact, groups: GroupShift[]) {
  const moved = (x: GoalImpact["groups"][number]) => x.share_after - x.share_before;
  // Near-ties (as with two groups, where one's gain is the other's loss) go to the group that grew.
  const g = [...impact.groups].sort((a, b) => {
    const gap = Math.abs(moved(b)) - Math.abs(moved(a));
    return Math.abs(gap) > 0.005 ? gap : moved(b) - moved(a);
  })[0];
  const name = groups.find(x => x.id === g?.id)?.headline;
  return g && name ? { name, more: g.share_after > g.share_before, better: (g.rate_before + g.rate_after) / 2 > (impact.rate_before + impact.rate_after) / 2 } : null;
}

function impactSentences(impact: GoalImpact, goal: string, device: Device, groups: GroupShift[], note: string): string[] {
  const { total, mix, behaviour } = impact;
  const moved = `${goal}: ${pct(impact.rate_before)} → ${pct(impact.rate_after)} of ${device} visits since ${day(impact.since)}${note}`;
  const mover = mainMover(impact, groups);
  const who = mover ? `${mover.more ? "more" : "fewer"} ${mover.name}, who reach it ${mover.better ? "more" : "less"} often` : "a change in who's visiting";
  const push = (v: number) => (v > 0 ? "up" : "down");
  if (real(total)) {
    if (real(mix) && !real(behaviour)) return [`${moved}. Driven by who's visiting: ${who}.`];
    if (real(behaviour) && !real(mix)) return [`${moved}. Driven by how visitors behave, not who's visiting.`];
    if (real(mix) && real(behaviour)) {
      return [Math.sign(mix[0]) === Math.sign(behaviour[0])
        ? `${moved}. Partly who's visiting (${who}), partly how they behave.`
        : `${moved}. Who's visiting pushed it ${push(mix[0])}; how they behave pushed it ${push(behaviour[0])}.`];
    }
    return [`${moved}.`];
  }
  if (real(mix) && real(behaviour) && Math.sign(mix[0]) !== Math.sign(behaviour[0])) {
    return [`${goal} held at about ${pct(impact.rate_after)} since ${day(impact.since)}${note}: who's visiting pushed it ${push(mix[0])}, how they behave pushed it back.`];
  }
  if (real(mix)) return [`${moved}, not conclusive yet. What holds up: ${who}, worth about ${points(mix[0])}.`];
  return [];
}

function cause(g: GroupShift): string {
  const top = g.sources?.drivers[0];
  if (top) {
    const from = top.source === "no referrer" ? "with no referrer" : `from ${top.source}`;
    return `, ${top.part >= 0.6 ? "mostly" : "partly"} down to ${top.traffic_after > top.traffic_before ? "more" : "fewer"} visits ${from}`;
  }
  return g.sources && real(g.sources.within) && !real(g.sources.traffic) ? ", across traffic sources" : "";
}

/** Plain sentences on what changed, the clearest first; empty when nothing held up. The goal's change comes first,
 * then group shifts with the traffic behind them, then changes in how a group behaves. */
export function shiftSentences(shifts: DeviceShifts | null, device: Device, context: { goal?: string | null; changes?: { day: string; note: string | null }[] } = {}): string[] {
  if (!shifts) return [];
  const changes = context.changes || [];
  let noted = false;
  // A recorded change is mentioned once, on the first sentence it lines up with.
  const note = (at: number) => {
    const text = noted ? "" : nearChange(at, changes);
    if (text) noted = true;
    return text;
  };
  const out: string[] = shifts.impact && context.goal ? impactSentences(shifts.impact, context.goal, device, shifts.groups, note(shifts.impact.since)) : [];
  const firstWeek = day(shifts.bins[0].from);
  // With two groups, one growing is the other shrinking: say it once.
  const groups = shifts.groups.length === 2 && shifts.groups.every(g => g.event === "grew" || g.event === "shrank")
    ? shifts.groups.filter(g => g.event === "grew") : shifts.groups;
  for (const g of groups) {
    const near = g.since ? note(g.since) : "";
    if (g.event === "appeared") out.push(`New: ${g.headline}, ${pct(g.to)} of ${device} visits since ${day(g.since!)}${near}${cause(g)}.`);
    if (g.event === "faded") out.push(`${g.headline} faded out after ${day(g.since!)}${near}: ${pct(g.from)} → ${pct(g.to)} of ${device} visits.`);
    if (g.steps && g.steps.length > 2) {
      const [first, ...rest] = g.steps;
      const [next, ...later] = rest;
      const after = later.map(s => `, then ${Math.abs(s.share - first.share) < 0.03 ? "back " : ""}to ${pct(s.share)} around ${day(s.since)}`).join("");
      out.push(`${g.headline}: ${pct(first.share)} → ${pct(next.share)} of ${device} visits around ${day(next.since)}${near}${after}${cause(g)}.`);
    } else if (g.event === "grew" || g.event === "shrank") out.push(`${g.headline}: ${pct(g.from)} → ${pct(g.to)} of ${device} visits since ${day(g.since!)}${near}${cause(g)}.`);
  }
  for (const g of shifts.groups) for (const d of g.drift) {
    const what = MEASURES[d.feature];
    if (what) out.push(`${g.headline} now ${what} ${amount(d.change)} they did ${d.since ? `before ${day(d.since)}` : `around ${firstWeek}`}.`);
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
