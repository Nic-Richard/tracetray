import { useEffect, useMemo, useRef, useState } from "react";
import { blendFrames, groupColorSlots, groupIdentity, timelapseGroups, type Device, type GroupHistoryFrame } from "@tracetray/shared";

const H = 340, PAD = { left: 52, right: 16, top: 14, bottom: 40 };
const Y_MIN = Math.log10(2), Y_MAX = Math.log10(1200);
const Y_TICKS = [[5, "5 s"], [30, "30 s"], [120, "2 min"], [600, "10 min"]] as const;
const HUES = ["--d1", "--d2", "--d3", "--d4", "--d5", "--d6"];
const STEP_MS = 1400;

const sy = (y: number) => H - PAD.bottom - ((Math.min(Y_MAX, Math.max(Y_MIN, y)) - Y_MIN) / (Y_MAX - Y_MIN)) * (H - PAD.top - PAD.bottom);
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export default function GroupTimelapseView({ history }: { history: GroupHistoryFrame[] }) {
  const [device, setDevice] = useState<Device>("desktop");
  const frames = useMemo(() => history.filter(f => f[device]), [history, device]);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);
  // The chart is drawn at its real width, so its text stays readable on a phone instead of shrinking with it.
  const [W, setW] = useState(640);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!box.current) return;
    const observer = new ResizeObserver(([entry]) => setW(Math.max(300, Math.round(entry.contentRect.width))));
    observer.observe(box.current);
    return () => observer.disconnect();
  }, [history]);
  const sx = (x: number) => PAD.left + Math.min(1, Math.max(0, x)) * (W - PAD.left - PAD.right);

  useEffect(() => { setPosition(Math.max(0, frames.length - 1)); setPlaying(false); }, [frames.length, device]);

  useEffect(() => {
    if (!playing) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = window.setInterval(() => setPosition(p => Math.min(frames.length - 1, Math.floor(p) + 1)), STEP_MS);
      return () => window.clearInterval(id);
    }
    let last = performance.now();
    const tick = (now: number) => {
      // A frame's timestamp can be slightly older than the moment playback started.
      const elapsed = Math.max(0, now - last);
      last = now;
      setPosition(p => Math.min(frames.length - 1, p + elapsed / STEP_MS));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, frames.length]);

  useEffect(() => { if (playing && position >= frames.length - 1) setPlaying(false); }, [playing, position, frames.length]);

  const everyGroup = useMemo(() => timelapseGroups(frames.map(f => f[device])), [frames, device]);
  const colours = useMemo(() => {
    const slots = groupColorSlots(everyGroup.slice(0, HUES.length).map(g => g.key ?? undefined));
    return new Map(everyGroup.map((g, i) => [g.id, i < HUES.length && slots[i] < HUES.length ? `var(${HUES[slots[i]]})` : "var(--d-neutral)"]));
  }, [everyGroup]);

  if (history.length === 0) return null;
  const hasMobile = history.some(f => f.mobile);
  const index = Math.max(0, Math.min(Math.floor(position), frames.length - 1));
  const t = position - index;
  const from = frames[index]?.[device] || null, to = frames[Math.min(index + 1, frames.length - 1)]?.[device] || null;
  const groups = blendFrames(from, to, t).filter(g => g.opacity > 0.02).map(g => {
    const r = 6 + 22 * Math.sqrt(g.share);
    return { ...g, cx: sx(g.x), cy: sy(g.y), r, labelY: sy(g.y) - r - 6 };
  });
  // A label that would overlap one already placed goes under its circle instead.
  const placed: { x: number; y: number; w: number }[] = [];
  for (const g of [...groups].sort((a, b) => a.labelY - b.labelY)) {
    const w = g.headline.length * 7.2;
    if (placed.some(p => Math.abs(p.y - g.labelY) < 16 && Math.abs(p.x - g.cx) < (p.w + w) / 2)) g.labelY = g.cy + g.r + 16;
    placed.push({ x: g.cx, y: g.labelY, w });
  }

  const play = () => { if (position >= frames.length - 1) setPosition(0); setPlaying(p => !p); };

  return (
    <section className="panel timelapse">
      <div className="panel-head">
        <h2>How the groups moved</h2>
        <div className="end">
          <div className="seg" role="group" aria-label="Device">
            <button type="button" className={device === "desktop" ? "on" : ""} onClick={() => setDevice("desktop")}>Desktop</button>
            <button type="button" className={device === "mobile" ? "on" : ""} onClick={() => setDevice("mobile")} disabled={!hasMobile}>Mobile</button>
          </div>
        </div>
      </div>
      <div className="panel-body" ref={box}>
        {frames.length < 2 ? (
          <p className="muted">Each analysis adds a frame here. Once the page has been analysed twice, you can play how its visitor groups shift over time.</p>
        ) : (
          <>
            <p className="muted">Each dot is a visit, placed by how far down the page it got and how long it stayed. Circles are the groups, sized by their share.</p>
            <svg viewBox={`0 0 ${W} ${H}`} className="timelapse-plot" role="img"
              aria-label={`Visitor groups on ${day(frames[index].ran_at)}: ${groups.filter(g => g.opacity > 0.5).map(g => `${g.headline} ${Math.round(g.share * 100)}%`).join(", ")}`}>
              {Y_TICKS.map(([seconds, label]) => (
                <g key={label}>
                  <line x1={PAD.left} x2={W - PAD.right} y1={sy(Math.log10(seconds))} y2={sy(Math.log10(seconds))} className="grid" />
                  <text x={PAD.left - 8} y={sy(Math.log10(seconds)) + 4} textAnchor="end" className="tick">{label}</text>
                </g>
              ))}
              {[0, 0.25, 0.5, 0.75, 1].map(x => <text key={x} x={sx(x)} y={H - PAD.bottom + 18} textAnchor="middle" className="tick">{x * 100}%</text>)}
              <text x={(W + PAD.left) / 2} y={H - 6} textAnchor="middle" className="axis">How far down the page</text>
              {([[from, 1 - t], [t > 0 ? to : null, t]] as const).map(([frame, weight], f) => frame?.points.map(([x, y, id], i) => {
                const group = frame.groups.find(g => g.id === id);
                return <circle key={`${f}-${i}`} cx={sx(x)} cy={sy(y)} r={2.4} fill={group ? colours.get(groupIdentity(group)) : "var(--d-neutral)"} opacity={0.32 * weight} />;
              }))}
              {groups.map(g => (
                <g key={g.id} opacity={g.opacity}>
                  <circle cx={g.cx} cy={g.cy} r={g.r} fill={colours.get(g.id)} fillOpacity={0.2} stroke={colours.get(g.id)} strokeWidth={2}>
                    <title>{`${g.headline}: ${Math.round(g.share * 100)}% of visits`}</title>
                  </circle>
                  <text x={g.cx} y={g.labelY} textAnchor="middle" className="label">{g.headline}</text>
                </g>
              ))}
            </svg>
            <div className="timelapse-controls">
              <button type="button" className="btn" onClick={play} aria-pressed={playing}>{playing ? "Pause" : "Play"}</button>
              <input type="range" min={0} max={frames.length - 1} step={0.01} value={position} aria-label="Analysis date"
                onChange={e => { setPlaying(false); setPosition(Number(e.target.value)); }} />
              <span className="num">{day(frames[Math.round(position)].ran_at)}</span>
            </div>
            <details className="timelapse-table">
              <summary>Show as a table</summary>
              <table>
                <thead><tr><th>Analysis</th>{everyGroup.map(g => <th key={g.id}>{g.headline}</th>)}</tr></thead>
                <tbody>
                  {frames.map(f => (
                    <tr key={f.ran_at}>
                      <td>{day(f.ran_at)}</td>
                      {everyGroup.map(g => {
                        const match = f[device]?.groups.find(x => groupIdentity(x) === g.id);
                        return <td key={g.id} className="num">{match ? `${Math.round(match.share * 100)}%` : "–"}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        )}
      </div>
    </section>
  );
}
