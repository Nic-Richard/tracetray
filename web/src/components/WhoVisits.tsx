import { useState } from "react";
import { pagePath, percent, type AnalysisResult, type Device } from "@tracetray/shared";
import { alikeNote, inactiveVisits, INACTIVE_TEXT, visitorTypes } from "../lib/analysis";
import { groupColors } from "../lib/palette";
import { useAskAbout } from "../lib/askLink";

export default function WhoVisits({ result, page }: { result: AnalysisResult; page: string }) {
  const [device, setDevice] = useState<Device>("desktop");
  const askAbout = useAskAbout();
  const hasMobile = (result.mobile?.clusters?.length || 0) > 0;
  const types = visitorTypes(result, device);
  const colors = groupColors(types.map(t => t.key));
  const alike = alikeNote(result, device);
  const inactive = inactiveVisits(result, device);
  const rows = alike
    ? [{ id: -1, headline: "Visitors behave alike", share: 1 - (inactive?.share || 0), body: alike, color: "var(--d1)" }]
    : types.map((t, i) => ({ id: t.id, headline: t.headline, share: t.share, body: t.story?.body?.replace(/^\d+% of (desktop|mobile) visitors\. /, "") || "", color: colors[i] }));
  if (inactive) rows.push({ id: -2, headline: "Left without interacting", share: inactive.share, body: `${INACTIVE_TEXT[device]}${inactive.goal ? ` ${percent(inactive.goal.rate)} of them reached ${inactive.goal.name}.` : ""}`, color: "var(--d-neutral)" });

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
            <div className="stack" role="img" aria-label={rows.map(r => `${r.headline} ${Math.round(r.share * 100)}%`).join(", ")}>
              {rows.map(row => <span key={row.id} style={{ flex: row.share, background: row.color }} />)}
            </div>
            <div className="who">
              {rows.map(row => (
                <div className="who-row" key={row.id}>
                  <span className="dot" style={{ background: row.color }} />
                  <b>{row.headline} <span className="num" style={{ color: row.color }}>{Math.round(row.share * 100)}%</span></b>
                  {row.body && <p>{row.body}</p>}
                  {row.id >= 0 && (
                    <button type="button" className="ask-link" onClick={() =>
                      askAbout(`On ${pagePath(page)}, what does the "${row.headline}" group (${Math.round(row.share * 100)}% of ${device} visitors) tell me, and what should I change?`)}>
                      Ask about this group
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
