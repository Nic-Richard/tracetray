import { percent, type PageShotInfo, type Reach, type SectionAttention } from "@tracetray/shared";

interface Props {
  src: string;
  info: PageShotInfo;
  bands: number[];
  color: string;
  reach?: Reach | null;
  goal?: { name: string; depth: number } | null;
  parts?: SectionAttention | null;
  label: string;
}

const PINS = 5;

// Depths are shares of the whole page, but very long pages are pictured only down to a limit.
export default function PagePicture({ src, info, bands, color, reach, goal, parts, label }: Props) {
  const scale = info.page_height / info.shown_height;
  const at = (depth: number) => depth * scale <= 1 ? { top: percent(depth * scale, 2) } : null;
  const atPx = (top: number, left?: number) => {
    const pos = at(top / info.page_height);
    return pos && left != null ? { ...pos, left: percent(left / info.width, 2) } : pos;
  };
  // With the page's sections known, each section carries its own reach, so only the first-screen line stays.
  const sections = parts?.sections.length ? parts.sections : null;
  const lines = [
    reach?.fold != null && { key: "fold", depth: reach.fold, text: "First screen ends", kind: "fold" },
    reach && !sections && { key: "p75", depth: reach.p75, text: "75% get here", kind: "reach" },
    reach && !sections && { key: "p50", depth: reach.p50, text: "Half get here", kind: "reach" },
    reach && !sections && { key: "p25", depth: reach.p25, text: "25% get here", kind: "reach" }
  ].filter((l): l is { key: string; depth: number; text: string; kind: string } => Boolean(l) && (l as { depth: number }).depth < 0.98);
  const crowded = (i: number) => lines.some((other, j) => j < i && Math.abs(other.depth - lines[i].depth) * scale < 0.05);
  // The goal's label sits above its line, so it drops below when a right-hand label sits just above it.
  const goalBelow = goal != null && lines.some((line, i) => !crowded(i) && goal.depth >= line.depth && (goal.depth - line.depth) * scale < 0.07);
  const candidates = parts ? [
    ...parts.elements.slice(0, PINS).map(el => ({ key: `u${el.top}-${el.left}`, top: el.top + el.height / 2, left: el.left + el.width / 2, text: percent(el.share), kind: "used", title: `${el.text || el.href}: used in ${percent(el.share)} of visits` })),
    ...parts.dead.slice(0, 2).map(d => ({ key: `d${d.top}-${d.left}`, top: d.top, left: d.left, text: percent(d.share), kind: "dead", title: `${d.name || "Not a button"}: clicked in ${percent(d.share)} of visits, does nothing` }))
  ] : [];
  // A pin too close to a busier one would cover it; the busier one stays. Pins keep a fixed size while the picture
  // shrinks with the screen, so closeness is measured against the picture's width.
  const pins = candidates.filter((pin, i) => !candidates.slice(0, i).some(o => Math.abs(o.top - pin.top) < info.width * 0.07 && Math.abs(o.left - pin.left) < info.width * 0.12));

  return (
    <div className="page-picture" role="img" aria-label={label}>
      <div className="page-picture-inner">
        <img src={src} alt="" />
        <div className="page-picture-heat" style={{ height: percent(scale, 2) }}>
          {bands.map((weight, i) => <i key={i} style={{ opacity: (weight * 0.55).toFixed(3), background: color }} />)}
        </div>
        {sections?.map(s => {
          const pos = atPx(s.top);
          return pos && <div key={s.name} className="page-section" style={pos}><span>{percent(s.reach)} reach{s.seconds != null ? ` · ${s.seconds} s` : ""}</span></div>;
        })}
        {lines.map((line, i) => {
          const pos = at(line.depth);
          return pos && <div key={line.key} className={`page-line ${line.kind}${crowded(i) ? " left" : ""}`} style={pos}><span>{line.text}</span></div>;
        })}
        {!sections && goal && at(goal.depth) && <div className={`page-line goal${goalBelow ? " below" : ""}`} style={at(goal.depth)!}><span>{goal.name}</span></div>}
        {pins.map(pin => {
          const pos = atPx(pin.top, pin.left);
          return pos && <div key={pin.key} className={`page-pin ${pin.kind}`} style={pos} title={pin.title}><span>{pin.text}</span></div>;
        })}
      </div>
    </div>
  );
}
