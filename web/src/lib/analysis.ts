import type { AnalysisResult, ClusterStory, Device, Interpretation } from "@tracetray/shared";

export function interpretationOf(result: AnalysisResult | null | undefined): Interpretation | null {
  return result?.interpretation || result?.ai_interpretation || null;
}

export interface VisitorType {
  id: number;
  key?: string;
  share: number;
  sessions: number;
  story: ClusterStory | null;
  headline: string;
}

export function visitorTypes(result: AnalysisResult | null | undefined, device: Device): VisitorType[] {
  const source = device === "mobile" ? result?.mobile : result;
  const clusters = source?.clusters || [];
  const total = clusters.reduce((sum, c) => sum + (c.n || 0), 0) || 1;
  const interpretation = interpretationOf(result);
  const stories = (device === "mobile" ? interpretation?.mobile_cluster_stories : interpretation?.cluster_stories) || {};
  return [...clusters]
    .sort((a, b) => b.n - a.n)
    .map(c => ({ id: c.id, key: stories[c.id]?.key, share: c.n / total, sessions: c.n, story: stories[c.id] || null, headline: stories[c.id]?.headline || c.label }));
}
