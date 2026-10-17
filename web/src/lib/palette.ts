import { useEffect, useState } from "react";
import { groupColorSlots } from "@tracetray/shared";

const HUES = ["--d1", "--d2", "--d3", "--d4", "--d5", "--d6", "--d-neutral"];

/** Colours for one page's groups, in display order; two groups on a page never share a colour. */
export function groupColors(keys: (string | undefined)[]): string[] {
  return groupColorSlots(keys).map(slot => `var(${HUES[slot]})`);
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
