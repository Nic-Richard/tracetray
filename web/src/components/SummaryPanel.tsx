import { useState } from "react";
import { analysisAdvice, groupCountNote, pagePath, type AnalysisResult, type FindingReference } from "@tracetray/shared";
import { useAskAbout } from "../lib/askLink";
import AnalysisScope from "./AnalysisScope";
import BeforeAfter from "./BeforeAfter";

export default function SummaryPanel({ result, page }: { result: AnalysisResult; page: string }) {
  const askAbout = useAskAbout();
  const advice = analysisAdvice(result);
  const [source, setSource] = useState<FindingReference | null>(null);
  const [following, setFollowing] = useState(false);
  if (advice.length === 0) return null;

  return (
    <><section className="panel summary">
      <div className="panel-head"><h2>What to try</h2></div>
      <div className="panel-body advice">
        {advice.map(item => (
          <div key={item.action} className="advice-item">
            <p className="advice-why">{item.evidence}</p>
            {(item.devices || [item.device]).map(device => <div key={device}><AnalysisScope result={result} device={device} />{groupCountNote(result, device) && <p className="note">{groupCountNote(result, device)}</p>}</div>)}
            <p className="advice-action">Change to try: {item.action}</p>
            {(item.devices || [item.device]).map(device => <button key={device} type="button" className="btn" onClick={() => { setSource({ ran_at: result.ran_at, device, group: item.group, action: item.action }); setFollowing(true); }}>Record this change{item.devices ? ` for ${device}` : ""}</button>)}
          </div>
        ))}
        <p className="note">
          <button type="button" className="ask-link" onClick={() => askAbout(`On ${pagePath(page)}: ${advice[0].action} Why, and how would I do it?`)}>
            Ask about this
          </button>
        </p>
        <button type="button" className="link-button" onClick={() => { setSource(null); setFollowing(value => !value); }}>Review recorded changes</button>
      </div>
    </section>
    {following && <BeforeAfter key={JSON.stringify(source)} page={page} source={source || undefined} />}</>
  );
}
