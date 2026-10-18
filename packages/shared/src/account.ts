import type { BugCategory, EmailList, Plan } from "./types";

export const EMAILS: { list: EmailList; name: string; about: string }[] = [
  { list: "weekly_summary", name: "Weekly summary", about: "Every Monday: last week's visits, busiest pages, what moved most and any shifts in visitor groups." },
  { list: "shift_alerts", name: "Behaviour-shift alerts", about: "After the weekly analysis, when a page's visitor groups move 10 points or more." }
];

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
export const DELETION_DETAILS = [
  "Permanently delete your TraceTray sign-in, account, all websites, visits, analyses, screenshots and saved settings. This cannot be undone.",
  "Any active TraceTray subscription is cancelled during deletion. No automatic refund is issued; refund rights required by law are unaffected. Remove the tracker from your websites too.",
  "Deletion normally starts within a few minutes. Failed steps retry automatically. A deletion receipt is kept for 30 days to prevent accidental reactivation; encrypted backups expire within 30 days. Payment providers may retain transaction records required by law. For help, contact support@tracetray.com."
];

export function deletionMessage(state: string): string {
  if (state === "complete") return "Your TraceTray account has been deleted.";
  if (state === "retrying") return "Deletion is still in progress. A step needs another attempt; TraceTray retries automatically. Contact support@tracetray.com if it stays here.";
  return "Your deletion request is saved. Your account is closed while TraceTray cancels subscriptions and removes your data. You can sign out now.";
}
