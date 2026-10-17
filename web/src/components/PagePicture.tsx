import { percent, type PageShotInfo, type Reach } from "@tracetray/shared";

interface Props {
  src: string;
  info: PageShotInfo;
  bands: number[];
  color: string;
  reach?: Reach | null;
  goal?: { name: string; depth: number } | null;
  label: string;
}

// Depths are shares of the whole page, but very long pages are pictured only down to a limit.
export default function PagePicture({ src, info, bands, color, reach, goal, label }: Props) {
  const scale = info.page_height / info.shown_height;
  const at = (depth: number) => depth * scale <= 1 ? { top: percent(depth * scale, 2) } : null;
  const lines = [
    reach?.fold != null && { key: "fold", depth: reach.fold, text: "First screen ends", kind: "fold" },
    reach && { key: "p75", depth: reach.p75, text: "75% get here", kind: "reach" },
    reach && { key: "p50", depth: reach.p50, text: "Half get here", kind: "reach" },
    reach && { key: "p25", depth: reach.p25, text: "25% get here", kind: "reach" }
  ].filter((l): l is { key: string; depth: number; text: string; kind: string } => Boolean(l) && (l as { depth: number }).depth < 0.98);

  return (
    <div className="page-picture" role="img" aria-label={label}>
      <div className="page-picture-inner">
        <img src={src} alt="" />
        <div className="page-picture-heat" style={{ height: percent(scale, 2) }}>
          {bands.map((weight, i) => <i key={i} style={{ opacity: (weight * 0.55).toFixed(3), background: color }} />)}
        </div>
        {lines.map((line, i) => {
          const pos = at(line.depth);
          const crowded = lines.some((other, j) => j < i && Math.abs(other.depth - line.depth) * scale < 0.05);
          return pos && <div key={line.key} className={`page-line ${line.kind}${crowded ? " left" : ""}`} style={pos}><span>{line.text}</span></div>;
        })}
        {goal && at(goal.depth) && <div className="page-line goal" style={at(goal.depth)!}><span>{goal.name}</span></div>}
      </div>
    </div>
  );
}
