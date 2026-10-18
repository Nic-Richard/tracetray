import type { PathStep } from "./types";

export const PATH_MIN_STEPS = 2;
export const PATH_MAX_STEPS = 6;

export function pathInputError(name: string, steps: readonly string[]): string | null {
  if (!name.trim()) return "Give the path a name.";
  if (steps.length < PATH_MIN_STEPS || steps.length > PATH_MAX_STEPS) return "A path has 2 to 6 pages.";
  if (steps.some(step => !step.trim())) return "Choose a page for every step.";
  if (new Set(steps).size !== steps.length) return "Each page can only be one step.";
  return null;
}

export function pathStepStats(steps: readonly Pick<PathStep, "all">[], index: number) {
  const first = steps[0]?.all || 0;
  const count = steps[index]?.all || 0;
  const previous = index > 0 ? steps[index - 1]?.all || 0 : 0;
  const share = (value: number, total: number) => total > 0 ? Math.min(1, Math.max(0, value / total)) : null;
  return {
    fromStart: share(count, first),
    fromPrevious: index > 0 ? share(count, previous) : null,
    lost: index > 0 ? Math.max(0, previous - count) : 0
  };
}
