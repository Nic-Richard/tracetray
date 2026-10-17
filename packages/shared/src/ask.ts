import type { AskTurn } from "./types";

export const ASK_STARTERS = [
  "Which pages got the most visits in the last 30 days?",
  "Where are my visitors coming from?",
  "Where do people leave the site?",
  "How do mobile visitors behave differently from desktop?",
  "Has anything changed across my recent analyses?"
];

export const ASK_LOOKUPS: Record<string, string> = {
  list_pages: "Pages", get_pages_in_group: "Pages in a group", get_overview: "Overview", get_traffic_trend: "Daily traffic",
  get_top_clicks: "Clicks", get_traffic_sources: "Traffic sources", get_visitor_journeys: "Journeys",
  get_ux_trends: "Weekly trends", get_attention: "Attention", get_goals: "Goals"
};

export interface AskEntry {
  question: string;
  answer?: string;
  lookups?: string[];
  error?: string;
  retryable?: boolean;
}

export function askHistory(entries: AskEntry[]): AskTurn[] {
  return entries.filter(entry => entry.answer).slice(-3).flatMap(entry => [
    { role: "user" as const, text: entry.question },
    { role: "assistant" as const, text: entry.answer! }
  ]);
}

export function answerBlocks(text: string): (string | string[])[] {
  const blocks: (string | string[])[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const last = blocks[blocks.length - 1];
    if (/^[-*•] /.test(line)) Array.isArray(last) ? last.push(line.slice(2)) : blocks.push([line.slice(2)]);
    else if (line) blocks.push(line.replace(/^#+\s*/, ""));
  }
  return blocks;
}

export function answerSpans(text: string): { text: string; bold: boolean }[] {
  return text.split(/\*\*(.+?)\*\*/g).map((text, index) => ({ text, bold: index % 2 === 1 }));
}
