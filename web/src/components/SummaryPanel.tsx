import { analysisAdvice, pagePath, type AnalysisResult } from "@tracetray/shared";
import { useAskAbout } from "../lib/askLink";

export default function SummaryPanel({ result, page }: { result: AnalysisResult; page: string }) {
  const askAbout = useAskAbout();
  const advice = analysisAdvice(result);
  if (advice.length === 0) return null;

  return (
    <section className="panel summary">
      <div className="panel-head"><h2>What to try</h2></div>
      <div className="panel-body advice">
        {advice.map(item => (
          <div key={item.action} className="advice-item">
            <p className="advice-action">{item.action}</p>
            <p className="advice-why">{item.evidence}</p>
          </div>
        ))}
        <p className="note">
          <button type="button" className="ask-link" onClick={() => askAbout(`On ${pagePath(page)}: ${advice[0].action} Why, and how would I do it?`)}>
            Ask about this
          </button>
        </p>
      </div>
    </section>
  );
}
