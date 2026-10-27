import type { GroupSnapshot } from "./types";

export interface TimelapseGroup {
  id: string;
  key: string | null;
  headline: string;
  share: number;
  x: number;
  y: number;
  /** 0 to 1: groups fade in when they appear and fade out when they go. */
  opacity: number;
}

export const groupIdentity = (g: GroupSnapshot["groups"][number]) => g.track || `${g.key}:${g.headline}`;

/** Group centres partway (t from 0 to 1) between two analyses, matched by tracked identity. */
export function blendFrames(from: GroupSnapshot | null, to: GroupSnapshot | null, t: number): TimelapseGroup[] {
  const before = new Map((from?.groups || []).filter(g => g.centre).map(g => [groupIdentity(g), g]));
  const after = new Map((to?.groups || []).filter(g => g.centre).map(g => [groupIdentity(g), g]));
  const out: TimelapseGroup[] = [];
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(id), b = after.get(id);
    const start = (a || b)!, end = (b || a)!;
    out.push({
      id,
      key: end.key,
      headline: t < 0.5 ? start.headline : end.headline,
      share: start.share + (end.share - start.share) * t,
      x: start.centre![0] + (end.centre![0] - start.centre![0]) * t,
      y: start.centre![1] + (end.centre![1] - start.centre![1]) * t,
      opacity: a && b ? 1 : a ? 1 - t : t
    });
  }
  return out;
}

/** Every tracked group across the history, in order of first appearance (so each keeps one colour), with its latest name. */
export function timelapseGroups(frames: (GroupSnapshot | null)[]): { id: string; key: string | null; headline: string }[] {
  const seen = new Map<string, { id: string; key: string | null; headline: string }>();
  for (const frame of frames) {
    for (const g of frame?.groups || []) {
      const id = groupIdentity(g);
      seen.set(id, { id, key: seen.get(id)?.key ?? g.key, headline: g.headline });
    }
  }
  return [...seen.values()];
}
