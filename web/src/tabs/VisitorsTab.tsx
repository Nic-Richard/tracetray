import { useState } from "react";
import type React from "react";
import { pagePath, percent, type AnalysisResult, type Device } from "@tracetray/shared";
import { visitorTypes } from "../lib/analysis";
import { groupColors } from "../lib/palette";
import { useAskAbout } from "../lib/askLink";

const rate = (value: number) => percent(value, value < 0.1 ? 1 : 0);

export default function VisitorsTab({ result, page }: { result: AnalysisResult; page: string }) {
  const [device, setDevice] = useState<Device>("desktop");
  const askAbout = useAskAbout();
  const types = visitorTypes(result, device);
  const colors = groupColors(types.map(t => t.key));
  const source = device === "mobile" ? result.mobile : result;
  const hasMobile = (result.mobile?.clusters?.length || 0) > 0;

  return (
    <div className="content">
      <div className="tab-intro">
        <p>{source?.session_count ? `${source.session_count.toLocaleString()} ${device} visits, sorted into ${types.length} groups by how people moved, paused, clicked and scrolled.` : `No ${device} groups yet.`}</p>
        <div className="seg" role="group" aria-label="Device">
          <button type="button" className={device === "desktop" ? "on" : ""} onClick={() => setDevice("desktop")}>Desktop</button>
          <button type="button" className={device === "mobile" ? "on" : ""} onClick={() => setDevice("mobile")} disabled={!hasMobile}>Mobile</button>
        </div>
      </div>
      {types.length === 0 ? (
        <section className="panel"><p className="empty">{source?.failure?.message || `Not enough ${device} visits yet to sort them into groups.`}</p></section>
      ) : (
        <div className="type-grid">
          {types.map((type, i) => (
            <section className="panel type-card" key={type.id} style={{ "--type": colors[i], "--fill": colors[i] } as React.CSSProperties}>
              <div className="panel-head">
                <h2>{type.headline}</h2>
                <div className="end"><span className="share num">{Math.round(type.share * 100)}%</span></div>
              </div>
              <div className="panel-body type-body">
                <div className="meter" aria-hidden="true"><i style={{ width: `${type.share * 100}%` }} /></div>
                <p className="muted">{type.sessions.toLocaleString()} visits</p>
                {type.story?.goal && (
                  <p className="group-goal">
                    <span className={`verdict ${type.story.goal.standing === "above" ? "better" : type.story.goal.standing === "below" ? "worse" : ""}`}>{rate(type.story.goal.rate)} reached {type.story.goal.name}</span>
                    <small>{device} average {rate(type.story.goal.average)}</small>
                  </p>
                )}
                {type.story?.body && <p>{type.story.body.replace(/^\d+% of (desktop|mobile) visitors\. /, "")}</p>}
                {(type.story?.traits?.length || 0) > 0 && (
                  <>
                    <h3>Compared with the page average</h3>
                    <ul>{type.story!.traits!.map(trait => <li key={trait.feature}>They {trait.description}.</li>)}</ul>
                  </>
                )}
                {(type.story?.suggestions?.length || 0) > 0 && (
                  <>
                    <h3>What to try</h3>
                    <ul>{type.story!.suggestions.map(s => <li key={s}>{s}</li>)}</ul>
                  </>
                )}
                <button type="button" className="ask-link" onClick={() =>
                  askAbout(`What should I change on ${pagePath(page)} for the "${type.headline}" ${device} visitors, and why?`)}>
                  Ask about this group
                </button>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
