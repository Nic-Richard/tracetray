import { useState } from "react";
import type React from "react";
import { pagePath, percent, type AnalysisResult, type Device } from "@tracetray/shared";
import { alikeNote, deviceAnalysis, inactiveVisits, INACTIVE_TEXT, visitCount, visitorTypes } from "../lib/analysis";
import { groupColors } from "../lib/palette";
import TraitBars from "../components/TraitBars";
import { useAskAbout } from "../lib/askLink";

// Whole percentages, like the sentences beside them, unless that would round a few visits down to 0%.
const rate = (value: number) => percent(value, value > 0 && value < 0.01 ? 1 : 0);

function intro(result: AnalysisResult, device: Device, groups: number): string {
  const source = deviceAnalysis(result, device);
  if (!source?.session_count) return `No ${device} groups yet.`;
  const visits = visitCount(result, device);
  const inactive = source.inactive_count || 0;
  const lead = `${visits.toLocaleString()} ${device} visits`;
  const left = inactive ? `${inactive.toLocaleString()} left without interacting. ` : "";
  if (source.structure === "none") return `${lead}. ${left}${inactive ? "The rest" : "They"} behave much alike, so they're described as one.`;
  const sorted = `${inactive ? `The other ${source.session_count.toLocaleString()}` : "They"} are sorted into ${groups} groups by how people ${device === "mobile" ? "scrolled, paused and tapped" : "moved, paused, clicked and scrolled"}.`;
  const overlap = source.structure === "some" ? " The groups overlap, so read them as tendencies." : "";
  return `${lead}. ${left}${sorted}${overlap}`;
}

export default function VisitorsTab({ result, page }: { result: AnalysisResult; page: string }) {
  const [device, setDevice] = useState<Device>("desktop");
  const askAbout = useAskAbout();
  const types = visitorTypes(result, device);
  const colors = groupColors(types.map(t => t.key));
  const source = deviceAnalysis(result, device);
  const hasMobile = (result.mobile?.clusters?.length || 0) > 0;
  const alike = alikeNote(result, device);
  const inactive = inactiveVisits(result, device);

  return (
    <div className="content">
      <div className="tab-intro">
        <p>{intro(result, device, types.length)}</p>
        <div className="seg" role="group" aria-label="Device">
          <button type="button" className={device === "desktop" ? "on" : ""} onClick={() => setDevice("desktop")}>Desktop</button>
          <button type="button" className={device === "mobile" ? "on" : ""} onClick={() => setDevice("mobile")} disabled={!hasMobile}>Mobile</button>
        </div>
      </div>
      {types.length === 0 ? (
        <section className="panel"><p className="empty">{source?.failure?.message || `Not enough ${device} visits yet to sort them into groups.`}</p></section>
      ) : (
        <div className="type-grid">
          {alike ? (
            <section className="panel type-card" style={{ "--type": "var(--d1)", "--fill": "var(--d1)" } as React.CSSProperties}>
              <div className="panel-head">
                <h2>Visitors behave alike</h2>
                <div className="end"><span className="share num">{Math.round((1 - (inactive?.share || 0)) * 100)}%</span></div>
              </div>
              <div className="panel-body type-body">
                <div className="meter" aria-hidden="true"><i style={{ width: `${(1 - (inactive?.share || 0)) * 100}%` }} /></div>
                <p className="muted">{(source?.session_count || 0).toLocaleString()} visits</p>
                <p>{alike}</p>
                <button type="button" className="ask-link" onClick={() =>
                  askAbout(`How do ${device} visitors use ${pagePath(page)}, and what should I change?`)}>
                  Ask about these visitors
                </button>
              </div>
            </section>
          ) : types.map((type, i) => (
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
                {type.story?.summary !== undefined ? type.story.summary && <p>{type.story.summary}</p> : !type.story?.traits?.length && type.story?.body && <p>{type.story.body}</p>}
                {(type.story?.traits?.length || 0) > 0 && (
                  <>
                    <h3>Against the page average</h3>
                    <TraitBars traits={type.story!.traits!} color={colors[i]} />
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
          {inactive && (
            <section className="panel type-card" style={{ "--type": "var(--d-neutral)", "--fill": "var(--d-neutral)" } as React.CSSProperties}>
              <div className="panel-head">
                <h2>Left without interacting</h2>
                <div className="end"><span className="share num">{Math.round(inactive.share * 100)}%</span></div>
              </div>
              <div className="panel-body type-body">
                <div className="meter" aria-hidden="true"><i style={{ width: `${inactive.share * 100}%` }} /></div>
                <p className="muted">{inactive.count.toLocaleString()} visits</p>
                {inactive.goal && <p className="group-goal"><span className="verdict">{rate(inactive.goal.rate)} reached {inactive.goal.name}</span></p>}
                <p>{INACTIVE_TEXT[device]} Some read without touching anything; others left straight away. They can't be grouped, since there's no behaviour to compare.</p>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
