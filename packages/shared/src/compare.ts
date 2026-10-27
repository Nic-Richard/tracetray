import type { ChangeComparison, ChangeMeasures, ComparisonGroupScope, Device } from "./types";

export function comparisonGroupScope(scope: ComparisonGroupScope | null | undefined): string {
  if (!scope) return "This saved group snapshot has no scope details.";
  const dates = scope.from && scope.to ? `${scope.from.slice(0, 10)} to ${scope.to.slice(0, 10)} (UTC)` : "visit dates weren't saved";
  return `${scope.visits.toLocaleString()} desktop visits with recorded interaction, ${dates}. Without-interaction visits are excluded from these group shares. Snapshot analysed ${new Date(scope.ran_at).toISOString().slice(0, 10)}.`;
}

export function comparisonGoalSummary(goal: NonNullable<ChangeComparison["goal"]>): string {
  if (goal.before === null || goal.after === null) return `${goal.name}: not enough visits to compare goal rates.`;
  const direction = goal.after > goal.before ? "rose" : goal.after < goal.before ? "fell" : "was unchanged";
  const uncertainty = goal.provisional ? "Provisional: still collecting the planned 14 complete days. No conclusion yet."
    : goal.verdict === "unclear" ? "Too few visits or goal completions to distinguish a change from sampling variation."
    : goal.verdict === "same" ? "The data don't establish a clear difference; that doesn't prove the rates are equal."
    : "The difference exceeds the comparison's sampling threshold, but other changes in traffic or timing could explain it.";
  const interval = goal.difference_ci ? ` Estimated difference: ${((goal.after - goal.before) * 100).toFixed(1)} percentage points; approximate 95% interval ${(goal.difference_ci[0] * 100).toFixed(1)} to ${(goal.difference_ci[1] * 100).toFixed(1)} points. This assumes independent visits and doesn't account for repeated visitors or other traffic changes.` : "";
  return `${goal.name} ${direction}, from ${comparisonRate(goal.before)} to ${comparisonRate(goal.after)} of visits. ${uncertainty}${interval} This comparison doesn't establish that the page change caused the result.`;
}

export function comparisonPeriods(day: string, days: number, device?: Device | null): string {
  const at = Date.parse(`${day}T00:00:00Z`);
  const date = (offset: number) => new Date(at + offset * 86400000).toISOString().slice(0, 10);
  return `Before: ${date(-days)} to ${date(-1)}; after: ${date(1)} to ${date(days)} (UTC). ${device ? `${device === "mobile" ? "Mobile" : "Desktop"} only` : "Both devices"}; completed visits only, unfinished visits excluded. The change day (${day}) is excluded.`;
}

export function comparisonStatus(data: ChangeComparison): string {
  if (data.goal_status === "changed") return "The recorded goal was changed or removed. Record a new change with a new baseline before comparing goal rates.";
  if (data.goal_status === "backfilling") return "Goal counts are being recounted or need attention. Goal-rate comparisons are paused until the recount finishes.";
  if (data.goal_status === "none") return "No goal was recorded with this change. Behaviour can be compared, but there is no saved goal-rate baseline.";
  if (data.goal_status === "legacy") return "This older change has no saved goal definition. Its rates use the current main goal, which may differ from the original.";
  return "";
}

export const COMPARISON_WAITING = "Waiting for new visits. The change day is excluded; comparisons start after the next complete UTC day has ended. Refreshing the analysis doesn't create new visits.";
export const COMPARISON_TRAFFIC_NOTE = "Follow-up rates include quick conversions and visits without interaction; they don't use the goal model's matched-window exclusions. Traffic sources, repeat visitors, timing and other page changes can move these figures. Matching the device doesn't control for those differences.";

export const COMPARISON_MIN_VISITS = 30;
export const comparisonRate = (value: number | null) => value === null || !Number.isFinite(value) ? "–" : `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;
export interface ComparisonRow {
  key: keyof ChangeMeasures;
  label: string;
  format: (value: number) => string;
  better: "up" | "down" | null;
}
export const COMPARISON_ROWS: ComparisonRow[] = [
  { key: "visitsPerDay", label: "Visits a day", format: value => value.toFixed(value >= 10 ? 0 : 1), better: null },
  { key: "engaged", label: "Engaged visits", format: value => `${Math.round(value * 100)}%`, better: "up" },
  { key: "actionsPerVisit", label: "Clicks or taps per visit", format: value => value.toFixed(2), better: null },
  { key: "scrollDepth", label: "Scroll depth", format: value => `${Math.round(value * 100)}%`, better: null },
  { key: "timeOnPage", label: "Time on page", format: value => `${Math.round(value / 1000)} s`, better: null },
  { key: "phoneShare", label: "On phones", format: value => `${Math.round(value * 100)}%`, better: null }
];

export function comparisonVerdict(row: ComparisonRow, before: number, after: number) {
  if (!row.better || !before) return null;
  const change = (after - before) / before;
  if (Math.abs(change) < 0.03) return "same";
  return (change > 0) === (row.better === "up") ? "better" : "worse";
}

export function changeDayError(day: string, today = new Date().toISOString().slice(0, 10)): string | null {
  const timestamp = /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(`${day}T00:00:00Z`) : NaN;
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== day) return "Enter a valid date as YYYY-MM-DD.";
  return day > today ? "The change can't be in the future." : null;
}
