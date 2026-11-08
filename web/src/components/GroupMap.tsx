import { useEffect, useMemo, useRef, useState } from "react";
import { mapDirections, measureName, percent, type DeviceShifts, type GroupMap as GroupMapData } from "@tracetray/shared";

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

interface Props { shifts: DeviceShifts; map: GroupMapData; hues: string[]; device: string; arrows?: boolean; changes?: { day: string; note: string | null }[] }

export default function GroupMap({ shifts, map, hues, device, arrows = false, changes = [] }: Props) {
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
  const start = shifts.bins[0].from, span = shifts.bins[last].to - start;
  const recorded = changes.map(c => ({ ...c, at: (Date.parse(`${c.day}T00:00:00Z`) - start) / span })).filter(c => c.at >= 0 && c.at <= 1);
  const bin = shifts.bins[Math.round(t)];
  const ends = mapDirections(map);
  // Biplot: each measure's correlation with the two directions, drawn from the average visit.
  const origin = map.origin || [0, 0];
  const reach = 0.9;
  // Measures pointing within 12 degrees of each other move together, so they share one arrow and one label.
  const measures: { names: string[]; a: number; b: number }[] = [];
  for (const [feature, [a, b]] of Object.entries(map.loadings || {}).sort((p, q) => Math.hypot(...q[1]) - Math.hypot(...p[1])).slice(0, 6)) {
    const same = measures.find(m => Math.abs(Math.atan2(m.b, m.a) - Math.atan2(b, a)) < Math.PI / 15);
    if (same) same.names.push(measureName(feature));
    else measures.push({ names: [measureName(feature)], a, b });
  }
  const numbered = W < 520;
  const perLine = Math.max(14, Math.floor((W * 0.45) / 6.4));
  const arrowLabels: { x: number; y: number }[] = [];
  const drawn = measures.map(m => {
    const x1 = sx(origin[0]), y1 = sy(origin[1]), x2 = sx(origin[0] + m.a * reach), y2 = sy(origin[1] + m.b * reach);
    const right = x2 >= x1, down = y2 >= y1;
    const lines = m.names.join(", ").split(" ").reduce<string[]>((out, word) => {
      if (out.length && (out[out.length - 1] + " " + word).length <= perLine) out[out.length - 1] += " " + word;
      else out.push(word);
      return out;
    }, []);
    const width = Math.max(...lines.map(l => l.length)) * 6.4;
    let y = down ? y2 + 13 : y2 - 5 - (lines.length - 1) * 13;
    while (arrowLabels.some(l => Math.abs(l.y - y) < 13 * lines.length && Math.abs(l.x - x2) < 120)) y += down ? 13 : -13;
    arrowLabels.push({ x: x2, y });
    const tx = right ? Math.min(x2 + 4, W - 4 - width) : Math.max(x2 - 4, 4 + width);
    return { key: m.names.join(), x1, y1, x2, y2, lines, tx, ty: y, anchor: (right ? "start" : "end") as "start" | "end" };
  });
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
        {arrows && drawn.map(m => (
          <g key={m.key} className="loading">
            <line x1={m.x1} y1={m.y1} x2={m.x2} y2={m.y2} markerEnd="url(#loading-head)" />
            {numbered
              ? <text x={m.x2 + (m.x2 >= m.x1 ? 6 : -6)} y={m.y2 + 4} textAnchor={m.anchor} className="tip">{drawn.indexOf(m) + 1}</text>
              : <text x={m.tx} y={m.ty} textAnchor={m.anchor}>{m.lines.map((line, n) => <tspan key={n} x={m.tx} dy={n ? 13 : 0}>{line}</tspan>)}</text>}
          </g>
        ))}
        <defs><marker id="loading-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10Z" /></marker></defs>
        {arrows && ends.up && <text x={W / 2} y={16} className="edge" textAnchor="middle">↑ {ends.up}</text>}
        {arrows && ends.down && <text x={W / 2} y={H - 8} className="edge" textAnchor="middle">↓ {ends.down}</text>}
      </svg>
      {arrows && numbered && <ol className="map-arrow-key">{drawn.map(m => <li key={m.key}>{m.lines.join(" ")}</li>)}</ol>}
      {arrows && (ends.left || ends.right) && <div className="map-ends"><span>{ends.left && `← ${ends.left}`}</span><span>{ends.right && `${ends.right} →`}</span></div>}
      <div className="map-controls">
        <button type="button" className="btn" onClick={() => setPlaying(p => !p)} aria-pressed={playing}>{playing ? "Pause" : t >= last ? "Replay" : "Play"}</button>
        <div className="map-scrub">
          <input type="range" min={0} max={last} step={0.01} value={t} aria-label="Time"
            aria-valuetext={`${day(bin.from)} to ${day(bin.to)}`} onChange={e => { setPlaying(false); setT(Number(e.target.value)); }} />
          {recorded.map(c => <i key={c.day + c.note} className="map-change" style={{ left: `${c.at * 100}%` }} title={`Your change on ${day(Date.parse(`${c.day}T00:00:00Z`))}${c.note ? `: ${c.note}` : ""}`} />)}
          {events.map(e => e.at >= 0 && <i key={e.g.id} className="map-event" style={{ left: `${(e.at / Math.max(1, last)) * 100}%`, background: `var(${hueOf.get(e.g.id)})` }} title={`${e.g.headline}: ${e.g.event} around ${day(e.g.since!)}`} />)}
        </div>
        <span className="map-date">{day(bin.from)}–{day(bin.to)}</span>
      </div>
    </div>
  );
}
