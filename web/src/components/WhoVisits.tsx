import { useState } from "react";
import { groupCountNote, pagePath, percent, visitCount, type AnalysisResult, type Device } from "@tracetray/shared";
import AnalysisScope from "./AnalysisScope";
import { alikeNote, deviceAverages, deviceGoal, inactiveVisits, INACTIVE_TEXT, interpretationOf, visitorTypes } from "../lib/analysis";
import { groupColors } from "../lib/palette";
import { useAskAbout } from "../lib/askLink";

interface Row {
  id: number;
  headline: string;
  share: number;
  text: string;
  color: string;
  goal: { rate: number; average: number; standing?: string } | null;
  figures?: string[];
}

function GoalBar({ goal, name, color }: { goal: NonNullable<Row["goal"]>; name: string; color: string }) {
  const tone = goal.standing === "above" ? "good" : goal.standing === "below" ? "bad" : "";
  return (
    <div className="who-goal" aria-label={`${percent(goal.rate)} reached ${name}, against ${percent(goal.average)} on average`}>
      <div className="who-goal-track"><i style={{ width: percent(goal.rate), background: color }} />{goal.average !== goal.rate && <span className="average" style={{ left: percent(goal.average) }} />}<span style={{ left: percent(goal.rate) }} /></div>
      <small><span><b className={tone}>{percent(goal.rate)}</b> reached {name}</span>{goal.average !== goal.rate && <span>average {percent(goal.average)}</span>}</small>
    </div>
  );
}

export default function WhoVisits({ result, page }: { result: AnalysisResult; page: string }) {
  const [device, setDevice] = useState<Device>("desktop");
  const askAbout = useAskAbout();
  const hasMobile = visitCount(result, "mobile") > 0;
  const types = visitorTypes(result, device);
  const colors = groupColors(types.map(t => t.key));
  const alike = alikeNote(result, device);
  const inactive = inactiveVisits(result, device);
  const goal = deviceGoal(result, device);
  const note = device === "desktop" ? interpretationOf(result)?.data_note : null;

  let rows: Row[];
  if (alike) {
    const averages = deviceAverages(result, device);
    rows = [{
      id: -1, headline: "No reliable groups found", share: 1 - (inactive?.share || 0), color: "var(--d1)",
      text: alike,
      goal: goal && { rate: goal.rate, average: goal.rate },
      figures: [
        averages.depth != null ? `${percent(averages.depth)} of the way down` : "",
        averages.actions != null ? `${(averages.actions * 60).toFixed(1)} ${device === "mobile" ? "taps" : "clicks"} a minute` : ""
      ].filter(Boolean)
    }];
  } else {
    rows = types.map((t, i) => ({
      id: t.id, headline: t.headline, share: t.share, color: colors[i],
      text: t.story?.summary ?? "",
      goal: t.story?.goal ? { rate: t.story.goal.rate, average: t.story.goal.average, standing: t.story.goal.standing } : null
    }));
  }
  if (inactive) {
    rows.push({
      id: -2, headline: "Left without interacting", share: inactive.share, color: "var(--d-neutral)", text: INACTIVE_TEXT[device],
      // Visits that never touched the page only reach a goal by arriving at it, so a zero here says nothing.
      goal: inactive.goal?.rate && goal ? { rate: inactive.goal.rate, average: goal.rate } : null
    });
  }

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
        <AnalysisScope result={result} device={device} />
        {groupCountNote(result, device) && <p className="note">{groupCountNote(result, device)}</p>}
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
                  {row.text && <p>{row.text}</p>}
                  {row.figures && row.figures.length > 0 && <p className="who-figures">{row.figures.map(f => <span key={f}>{f}</span>)}</p>}
                  {row.goal && goal && <GoalBar goal={row.goal} name={goal.name} color={row.color} />}
                  {row.id >= 0 && (
                    <button type="button" className="ask-link" onClick={() =>
                      askAbout(`On ${pagePath(page)}, what does the "${row.headline}" group (${Math.round(row.share * 100)}% of ${device} visitors) tell me, and what should I change?`)}>
                      Ask about this group
                    </button>
                  )}
                </div>
              ))}
            </div>
            {note && <p className="note who-note">{note}</p>}
          </>
        )}
      </div>
    </section>
  );
}
