import { useState } from "react";
import { pagePath, type AnalysisResult, type Device } from "@tracetray/shared";
import { visitorTypes } from "../lib/analysis";
import { groupColors } from "../lib/palette";
import { useAskAbout } from "../lib/askLink";

export default function WhoVisits({ result, page }: { result: AnalysisResult; page: string }) {
  const [device, setDevice] = useState<Device>("desktop");
  const askAbout = useAskAbout();
  const hasMobile = (result.mobile?.clusters?.length || 0) > 0;
  const types = visitorTypes(result, device);
  const colors = groupColors(types.map(t => t.key));

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Who visits</h2>
        <div className="end">
          <div className="seg" role="group" aria-label="Device">
            <button type="button" className={device === "desktop" ? "on" : ""} onClick={() => setDevice("desktop")}>Desktop</button>
            <button type="button" className={device === "mobile" ? "on" : ""} onClick={() => setDevice("mobile")} disabled={!hasMobile}
              title={hasMobile ? undefined : "Not enough phone visits yet"}>Mobile</button>
          </div>
        </div>
      </div>
      <div className="panel-body">
        {types.length === 0 ? (
          <p className="empty">{(device === "mobile" ? result.mobile?.failure?.message : result.failure?.message) || "Not enough visits yet to sort them into groups."}</p>
        ) : (
          <>
            <div className="stack" role="img" aria-label={types.map(t => `${t.headline} ${Math.round(t.share * 100)}%`).join(", ")}>
              {types.map((type, i) => <span key={type.id} style={{ flex: type.share, background: colors[i] }} />)}
            </div>
            <div className="who">
              {types.map((type, i) => (
                <div className="who-row" key={type.id}>
                  <span className="dot" style={{ background: colors[i] }} />
                  <b>{type.headline} <span className="num" style={{ color: colors[i] }}>{Math.round(type.share * 100)}%</span></b>
                  {type.story?.body && <p>{type.story.body.replace(/^\d+% of (desktop|mobile) visitors\. /, "")}</p>}
                  <button type="button" className="ask-link" onClick={() =>
                    askAbout(`On ${pagePath(page)}, what does the "${type.headline}" group (${Math.round(type.share * 100)}% of ${device} visitors) tell me, and what should I change?`)}>
                    Ask about this group
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
