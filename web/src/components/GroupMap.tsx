import { useEffect, useMemo, useRef, useState } from "react";
import { percent, type DeviceShifts, type GroupMap as GroupMapData } from "@tracetray/shared";

const STEP_MS = 1100;
// Below this share a group has no bubble in that frame; growing from here is how a new group arrives.
const HIDDEN = 0.015;
const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const ease = (f: number) => f * f * (3 - 2 * f);
const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

// Drawn at the container's real width so labels stay at their real size. The visits' extent is fitted into the
// space with one scale for both axes, so distances mean the same in every direction.
function geometry(width: number, extent: [number, number, number, number]) {
  const W = Math.max(300, Math.round(width));
  const [x0, x1, y0, y1] = extent;
  const room = W < 520 ? 48 : 70;
  // The height follows the shape of the cloud, so a wide, flat map doesn't leave empty bands.
  const fitted = ((W - 2 * room) / Math.max(0.2, x1 - x0)) * Math.max(0.2, y1 - y0) + 2 * room;
  const H = Math.round(Math.min(W < 520 ? W * 1.1 : 460, Math.max(W < 520 ? 230 : 280, fitted)));
  const scale = Math.min((W - 2 * room) / Math.max(0.2, x1 - x0), (H - 2 * room) / Math.max(0.2, y1 - y0));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, size = Math.min(W, H);
  return { W, H, sx: (x: number) => W / 2 + (x - cx) * scale, sy: (y: number) => H / 2 - (y - cy) * scale,
    radius: (share: number) => share < HIDDEN ? 0 : (size / 420) * (6 + 52 * Math.sqrt(share)) };
}

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

interface Props { shifts: DeviceShifts; map: GroupMapData; hues: string[]; device: string }

export default function GroupMap({ shifts, map, hues, device }: Props) {
  const last = map.frames.length - 1;
  const [t, setT] = useState(last);
  const [playing, setPlaying] = useState(false);
  const raf = useRef<number | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    if (!box.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(box.current);
    return () => observer.disconnect();
  }, []);
  const { W, H, sx, sy, radius } = geometry(width, map.extent || [-1, 1, -1, 1]);
  const groups = shifts.groups;
  const hueOf = useMemo(() => new Map(groups.map((g, i) => [g.id, hues[i]])), [groups, hues]);

  const at = useRef(t);
  at.current = t;
  useEffect(() => {
    if (!playing) return;
    const start = at.current >= last ? 0 : at.current;
    // With reduced motion, frames step once a second instead of gliding.
    if (reducedMotion()) {
      let frame = Math.floor(start);
      setT(frame);
      const timer = window.setInterval(() => {
        frame = Math.min(last, frame + 1);
        setT(frame);
        if (frame >= last) { setPlaying(false); window.clearInterval(timer); }
      }, STEP_MS);
      return () => window.clearInterval(timer);
    }
    const began = performance.now();
    const tick = (now: number) => {
      const value = Math.min(last, start + (now - began) / STEP_MS);
      setT(value);
      if (value >= last) setPlaying(false);
      else raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [playing, last]);

  const i = Math.min(Math.floor(t), last), next = Math.min(i + 1, last), f = ease(t - i);
  const bubbles = groups.map(g => {
    const a = map.frames[i].centres[String(g.id)], b = map.frames[next].centres[String(g.id)];
    const share = lerp(g.shares[i], g.shares[next], f), high = lerp(g.high[i], g.high[next], f);
    return { g, x: sx(lerp(a[0], b[0], f)), y: sy(lerp(a[1], b[1], f)), r: radius(share), ring: radius(high), share, hue: hueOf.get(g.id)! };
  });
  // Each label takes the first spot (above, below, right, left of its bubble) that covers no other bubble and no
  // label already placed; the biggest groups choose first.
  const shown = bubbles.filter(b => b.r > 0);
  const boxes: { l: number; r: number; t: number; b: number }[] = [];
  const labels = [...shown].sort((a, b) => b.share - a.share).map(b => {
    const text = `${b.g.headline} ${percent(b.share)}`;
    const w = text.length * 7.3, h = 16;
    const spots = [[b.x, b.y - b.r - 9], [b.x, b.y + b.r + 19], [b.x + b.r + 8 + w / 2, b.y + 5], [b.x - b.r - 8 - w / 2, b.y + 5]];
    const boxOf = ([x, y]: number[]) => ({ l: x - w / 2, r: x + w / 2, t: y - h + 3, b: y + 3 });
    const free = (box: { l: number; r: number; t: number; b: number }) => box.l >= 2 && box.r <= W - 2 && box.t >= 2 && box.b <= H - 2
      && !boxes.some(o => box.l < o.r && box.r > o.l && box.t < o.b && box.b > o.t)
      && !shown.some(o => o !== b && Math.hypot(Math.max(box.l, Math.min(o.x, box.r)) - o.x, Math.max(box.t, Math.min(o.y, box.b)) - o.y) < o.r);
    const spot = spots.find(s => free(boxOf(s))) || spots[0];
    boxes.push(boxOf(spot));
    return { key: b.g.id, x: Math.min(Math.max(spot[0], w / 2 + 4), W - w / 2 - 4), y: spot[1], text };
  });
  // With two groups, one growing is the other shrinking: one marker, in the colour of the group that grew.
  const changed = groups.filter(g => g.event && g.since);
  const marked = groups.length === 2 && changed.length === 2 && changed.every(g => g.event === "grew" || g.event === "shrank") ? changed.filter(g => g.event === "grew") : changed;
  const events = marked.map(g => ({ g, at: shifts.bins.findIndex(bin => g.since! < bin.to) }));
  const bin = shifts.bins[Math.round(t)];
  const dots = (frame: number, opacity: number, key: string) => opacity > 0.02 && map.frames[frame].points.map(([x, y, id], n) => (
    <circle key={`${key}${n}`} cx={sx(x)} cy={sy(y)} r={3.2} style={{ fill: `var(${hueOf.get(id) || "--d-neutral"})`, opacity: 0.55 * opacity }} />
  ));

  return (
    <div className="group-map" ref={box}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img"
        aria-label={`${bin.from ? `${day(bin.from)} to ${day(bin.to)}` : ""}: ${bubbles.filter(b => b.r > 0).map(b => `${b.g.headline} ${percent(b.share)}`).join(", ")} of ${device} visits.`}>
        {dots(i, 1 - f, "a")}
        {next !== i && dots(next, f, "b")}
        {bubbles.map(b => b.r > 0 && (
          <g key={b.g.id} style={{ color: `var(${b.hue})` }}>
            <circle cx={b.x} cy={b.y} r={b.ring} className="ring" />
            <circle cx={b.x} cy={b.y} r={b.r} className="bubble" />
          </g>
        ))}
        {labels.map(l => <text key={l.key} x={l.x} y={l.y} className="label" textAnchor="middle">{l.text}</text>)}
      </svg>
      <div className="map-controls">
        <button type="button" className="btn" onClick={() => setPlaying(p => !p)} aria-pressed={playing}>{playing ? "Pause" : t >= last ? "Replay" : "Play"}</button>
        <div className="map-scrub">
          <input type="range" min={0} max={last} step={0.01} value={t} aria-label="Time"
            aria-valuetext={`${day(bin.from)} to ${day(bin.to)}`} onChange={e => { setPlaying(false); setT(Number(e.target.value)); }} />
          {events.map(e => e.at >= 0 && <i key={e.g.id} className="map-event" style={{ left: `${(e.at / Math.max(1, last)) * 100}%`, background: `var(${hueOf.get(e.g.id)})` }} title={`${e.g.headline}: ${e.g.event} around ${day(e.g.since!)}`} />)}
        </div>
        <span className="map-date">{day(bin.from)}–{day(bin.to)}</span>
      </div>
      <p className="map-key">Dots are visits from that {shifts.bin_weeks === 1 ? "week" : "stretch"}. Bubbles are groups, sized by their share. Closer together means behaving more alike.</p>
      <details className="map-about"><summary>About this map</summary>
        <p>Every visit is placed by all the measures its group was built from, flattened to two dimensions; there are no axes, only distance. This flat view keeps {percent(map.explained)} of the differences between visits{map.explained < 0.5 ? ", so some groups can look closer here than they are" : ""}. The dashed ring around a bubble shows how large the group could plausibly be that {shifts.bin_weeks === 1 ? "week" : "stretch"}. A bubble only moves when its group's behaviour changed by more than chance; otherwise it stays put.</p>
      </details>
    </div>
  );
}
