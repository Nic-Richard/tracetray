import { useEffect, useState } from "react";

const HUES = ["--d1", "--d2", "--d3", "--d4", "--d5", "--d6"];

// Each kind of group keeps its colour on every page, so "Deep readers" always looks the same.
const PREFERRED: Record<string, string> = {
  deep_readers: "--d1", skimmers: "--d2", explorers: "--d3", hesitant: "--d4", deliberate: "--d5", header_scanners: "--d6",
  passive: "--d6", bottom_readers: "--d5", quick_deciders: "--d2", rechecking: "--d4",
  m_readers: "--d1", m_skimmers: "--d2", m_tappers: "--d3", m_quick_exits: "--d4", m_hesitant: "--d5", m_rechecking: "--d6", m_deep: "--d6"
};

/** Colours for one page's groups, in display order; two groups on a page never share a colour. */
export function groupColors(keys: (string | undefined)[]): string[] {
  const used = new Set<string>();
  return keys.map(key => {
    if (key === "typical") return "var(--d-neutral)";
    let hue = key ? PREFERRED[key] : undefined;
    if (!hue || used.has(hue)) hue = HUES.find(h => !used.has(h)) || HUES[used.size % HUES.length];
    used.add(hue);
    return `var(${hue})`;
  });
}

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Changes whenever the light or dark theme changes, so charts can redraw in the right colours. */
export function useThemeVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion(v => v + 1);
    const observer = new MutationObserver(bump);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", bump);
    return () => { observer.disconnect(); media.removeEventListener("change", bump); };
  }, []);
  return version;
}
