import type { ChangeComparison, ChangeMeasures, ComparisonGroupScope } from "./types";

export function comparisonGroupScope(scope: ComparisonGroupScope | null | undefined): string {
  if (!scope) return "This saved group snapshot has no scope details.";
  const dates = scope.from && scope.to ? `${scope.from.slice(0, 10)} to ${scope.to.slice(0, 10)} (UTC)` : "visit dates weren't saved";
  return `${scope.visits.toLocaleString()} desktop visits with recorded interaction, ${dates}. Without-interaction visits are excluded from these group shares. Snapshot analysed ${new Date(scope.ran_at).toISOString().slice(0, 10)}.`;
}

export function comparisonGoalSummary(goal: NonNullable<ChangeComparison["goal"]>): string {
  if (goal.before === null || goal.after === null) return `${goal.name}: not enough visits to compare goal rates.`;
  const direction = goal.after > goal.before ? "rose" : goal.after < goal.before ? "fell" : "was unchanged";
  const uncertainty = goal.verdict === "unclear" ? "Too few goal completions to distinguish a change from sampling variation."
    : goal.verdict === "same" ? "The data don't establish a clear difference; that doesn't prove the rates are equal."
    : "The difference exceeds the comparison's sampling threshold, but other changes in traffic or timing could explain it.";
  return `${goal.name} ${direction}, from ${comparisonRate(goal.before)} to ${comparisonRate(goal.after)} of visits. ${uncertainty} This comparison doesn't establish that the page change caused the result.`;
}

export function comparisonPeriods(day: string, days: number): string {
  const at = Date.parse(`${day}T00:00:00Z`);
  const date = (offset: number) => new Date(at + offset * 86400000).toISOString().slice(0, 10);
  return `Before: ${date(-days)} to ${date(-1)}; after: ${day} to ${date(days - 1)} (UTC). Both devices; completed visits only, unfinished visits excluded.`;
}

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
