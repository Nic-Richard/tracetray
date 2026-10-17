import type { AnalysisResult, AttentionProfile } from "@tracetray/shared";
import AttentionContent from "../../web/src/components/AttentionContent";
import { mount } from "./bridge";

mount<{ data: AttentionProfile; result: AnalysisResult | null; desktopShot: string | null; phoneShot: string | null; dark: boolean }>(props =>
  <div className="attention-surface"><AttentionContent {...props} /></div>
);
