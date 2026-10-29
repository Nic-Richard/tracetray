import type { ClickSeen, FormSeen, Goal } from "./types";

export function formLabel(form?: Pick<FormSeen, "id" | "name" | "action">): string {
  return !form ? "Form" : form.id ? `Form #${form.id}` : form.name ? `Form “${form.name}”` : `Form to ${form.action}`;
}

export function clickLabel(click: Pick<ClickSeen, "tag" | "id" | "text" | "href">): string {
  const what = click.text ? `“${click.text}”` : click.id ? `#${click.id}` : "A link";
  return click.href ? `${what}, link to ${click.href}` : `${what} ${click.tag === "A" ? "link" : "button"}`;
}

// Same rule as "Make this a goal" on the Clicks tab: a link's address survives rewording, otherwise the text.
export function clickMatch(click: Pick<ClickSeen, "tag" | "id" | "text" | "href">): { id?: string; href?: string; text?: string; tag?: string } {
  if (click.href) return { href: click.href };
  if (!click.text && click.id) return { id: click.id };
  return { text: click.text || "", ...(click.tag ? { tag: click.tag } : {}) };
}

export function describeGoal(goal: Pick<Goal, "type" | "match">): string {
  if (goal.type === "page") {
    let page = goal.match.page || "a page";
    try { page = new URL(page).pathname; } catch {}
    return `Goes on to ${page}`;
  }
  if (goal.type === "form") return `Sends the form ${goal.match.id ? `#${goal.match.id}` : goal.match.name ? `“${goal.match.name}”` : `to ${goal.match.action}`}`;
  if (goal.match.id) return `Clicks #${goal.match.id}`;
  if (goal.match.href) return `Clicks a link to ${goal.match.href}`;
  return `Clicks “${goal.match.text || ""}”`;
}

export function parseGoalTarget(value: string): { target: number | null; error?: string } {
  if (!value.trim()) return { target: null };
  const clean = value.trim().replace(",", ".");
  const percent = Number(clean);
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(clean) || !(percent > 0 && percent <= 100)) {
    return { target: null, error: "Enter a target greater than 0% and up to 100%, or leave it blank." };
  }
  return { target: percent / 100 };
}

export function goalAppliesToPage(goal: Pick<Goal, "pages" | "type" | "match">, page: string): boolean {
  return (!goal.pages.length || goal.pages.includes(page)) && !(goal.type === "page" && goal.match.page === page);
}
