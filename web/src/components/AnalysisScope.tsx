import { analysisPeriod, analysisScope, deviceAnalysis, type AnalysisResult, type Device } from "@tracetray/shared";

export default function AnalysisScope({ result, device }: { result: AnalysisResult; device: Device }) {
  return (
    <details className="note analysis-scope">
      <summary>{(deviceAnalysis(result, device)?.session_count || 0).toLocaleString()} {device} visits · {analysisPeriod(result, device)} · Scope and exclusions</summary>
      <p>{analysisScope(result, device)}</p>
    </details>
  );
}
