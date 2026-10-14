export function pagePath(page: string | null | undefined): string {
  if (!page) return "";
  try {
    const url = new URL(page);
    return url.pathname + (url.hash.startsWith("#/") || url.hash.startsWith("#!/") ? url.hash : "");
  } catch {
    return page;
  }
}

export function isPageGroup(page: string | null | undefined): boolean {
  return /\/:[a-z]/i.test(pagePath(page));
}

/** "Home" for the root, "Set page" style names for groups, the path otherwise. */
export function pageLabel(page: string | null | undefined): string {
  const path = pagePath(page);
  if (path === "/" || path === "") return "Home";
  if (!isPageGroup(page)) {
    const last = path.split("/").filter(Boolean).pop() || path;
    return decodeSegment(last).replace(/\.html?$/, "").replace(/[-_]+/g, " ").replace(/^./, c => c.toUpperCase());
  }
  const segments = path.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  const name = last.startsWith(":") ? last.slice(1) : last;
  if (name === "id") {
    const parent = segments.filter(s => !s.startsWith(":")).pop() || "item";
    return `${singular(parent)} pages`.replace(/^./, c => c.toUpperCase());
  }
  return `${name.replace(/[_-]/g, " ")} pages`.replace(/^./, c => c.toUpperCase());
}

function decodeSegment(segment: string): string {
  try { return decodeURIComponent(segment); } catch { return segment; }
}

function singular(word: string): string {
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("s") && word.length > 3) return word.slice(0, -1);
  return word;
}

export function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

export function percent(value: number | null | undefined, digits = 0): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "–" : `${(value * 100).toFixed(digits)}%`;
}

export function timeAgo(ms: number | string | null | undefined, now = Date.now()): string {
  const then = typeof ms === "string" ? Date.parse(ms) : Number(ms);
  if (!Number.isFinite(then)) return "never";
  const minutes = Math.round((now - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
