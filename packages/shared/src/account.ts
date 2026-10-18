import type { BugCategory, Plan } from "./types";

export const PLAN_NAMES: Record<Plan, string> = { starter: "Starter", pro: "Pro", ultra: "Ultra", enterprise: "Enterprise", none: "No plan" };

export const REPORT_CATEGORIES: { value: BugCategory; label: string }[] = [
  { value: "bug", label: "Something is broken" },
  { value: "suggestion", label: "Suggestion" },
  { value: "account", label: "Account" },
  { value: "billing", label: "Billing" },
  { value: "other", label: "Other" }
];

export function reportError(description: string): string | null {
  const length = description.trim().length;
  if (length < 10) return "Add a little more detail so the problem can be found.";
  if (length > 5000) return "Keep the report under 5,000 characters.";
  return null;
}

export function reportPageUrl(page: string): string {
  try {
    const url = new URL(page);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch { return ""; }
}

export function usageMeter(used: number, limit: number | null): { share: number | null; over: boolean } {
  return {
    share: limit === null ? null : limit <= 0 ? (used > 0 ? 1 : 0) : Math.min(1, Math.max(0, used / limit)),
    over: limit !== null && used > limit
  };
}
