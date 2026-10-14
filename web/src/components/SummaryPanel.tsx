import { pagePath, type AnalysisResult } from "@tracetray/shared";
import { interpretationOf } from "../lib/analysis";
import { useAskAbout } from "../lib/askLink";

export default function SummaryPanel({ result, page }: { result: AnalysisResult; page: string }) {
  const askAbout = useAskAbout();
  const interpretation = interpretationOf(result);
  if (!interpretation?.site_summary) return null;

  return (
    <section className="panel summary">
      <div className="panel-head">
        <h2>What stands out</h2>
        {interpretation.page_type && interpretation.page_type !== "Unclear" && <div className="end"><span className="ask-note">Looks like a {interpretation.page_type.toLowerCase()}</span></div>}
      </div>
      <div className="panel-body">
        <p>{interpretation.site_summary}</p>
        {(interpretation.top_suggestions?.length || 0) > 0 && (
          <ul>{interpretation.top_suggestions!.map(suggestion => <li key={suggestion}>{suggestion}</li>)}</ul>
        )}
        {interpretation.data_note && <p className="note">{interpretation.data_note}</p>}
        <p className="note">
          <button type="button" className="ask-link" onClick={() => askAbout(`What stands out about how people use ${pagePath(page)}, and what should I change first?`)}>
            Ask about this page
          </button>
        </p>
      </div>
    </section>
  );
}
