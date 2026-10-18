import type { ChangeMeasures } from "./types";

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
