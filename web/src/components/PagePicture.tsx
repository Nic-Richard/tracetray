import { useEffect, useState } from "react";
import { percent, type PageShotInfo, type Reach } from "@tracetray/shared";
import { useApi } from "../api";
import { useSite } from "../state/site";

export function usePageShot(page: string, device: "desktop" | "mobile", info: PageShotInfo | undefined): string | null {
  const api = useApi();
  const { siteKey } = useSite();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!info) { setUrl(null); return; }
    let objectUrl: string | null = null, cancelled = false;
    api.pageShot(siteKey, page, device).then(({ blob }) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => setUrl(null));
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [api, siteKey, page, device, info?.taken_at]);
  return url;
}

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
        {lines.map(line => {
          const pos = at(line.depth);
          return pos && <div key={line.key} className={`page-line ${line.kind}`} style={pos}><span>{line.text}</span></div>;
        })}
        {goal && at(goal.depth) && <div className="page-line goal" style={at(goal.depth)!}><span>{goal.name}</span></div>}
      </div>
    </div>
  );
}
