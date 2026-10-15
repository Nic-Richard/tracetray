import { useState } from "react";
import type React from "react";
import { pagePath, type ClickCount, type Goal } from "@tracetray/shared";
import { useAskAbout } from "../lib/askLink";
import { useApi } from "../api";
import { useSite } from "../state/site";
import { useLoad } from "../lib/useLoad";

const TAGS: Record<string, string> = { a: "Link", button: "Button", input: "Input", img: "Image", select: "Menu", label: "Label" };

const sameText = (a?: string | null, b?: string | null) => (a || "").trim().replace(/\s+/g, " ").toLowerCase() === (b || "").trim().replace(/\s+/g, " ").toLowerCase();

// A link is a goal by where it goes, so renaming it doesn't break the goal; a button by its label.
function goalFor(click: ClickCount) {
  return click.href ? { href: click.href } : { text: click.text, tag: click.tag };
}

function existingGoal(goals: Goal[], click: ClickCount) {
  return goals.find(g => g.type === "click" && (click.href
    ? g.match.href === click.href
    : sameText(g.match.text, click.text) && (!g.match.tag || g.match.tag === click.tag?.toUpperCase())));
}

export default function ClicksTab({ clicks, page }: { clicks: ClickCount[]; page: string }) {
  const askAbout = useAskAbout();
  const api = useApi();
  const { siteKey } = useSite();
  const goals = useLoad(() => api.goals(siteKey), [api, siteKey]);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState("");
  const max = Math.max(1, ...clicks.map(c => c.count));
  const full = goals.data ? goals.data.goals.length >= goals.data.cap : true;

  async function makeGoal(click: ClickCount, key: string) {
    setAdding(key); setError("");
    try {
      await api.addGoal(siteKey, { name: click.text, type: "click", match: goalFor(click) });
      goals.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The goal wasn't saved");
    } finally {
      setAdding(null);
    }
  }

  return (
    <div className="content">
      <section className="panel">
        <div className="panel-head">
          <h2>Most clicked</h2>
          <div className="end"><span className="ask-note">Desktop, newest 2,000 visits</span></div>
        </div>
        {clicks.length === 0 ? (
          <p className="empty">No clicks recorded on this page yet. Clicks on elements without visible text aren't listed.</p>
        ) : (
          <ol className="click-list with-goal" style={{ "--fill": "var(--d3)" } as React.CSSProperties}>
            {clicks.map(click => {
              const key = `${click.tag}:${click.href || click.text}`;
              const goal = goals.data ? existingGoal(goals.data.goals, click) : null;
              return (
                <li key={key}>
                  <span className="click-text"><b title={click.text}>{click.text}</b><small>{TAGS[click.tag?.toLowerCase()] || click.tag}{click.href ? ` to ${click.href}` : ""}</small></span>
                  <span className="meter"><i style={{ width: `${(click.count / max) * 100}%` }} /></span>
                  <b className="num">{click.count.toLocaleString()}</b>
                  {goal ? <span className="goal-tag">Goal</span>
                    : <button type="button" className="link-button" onClick={() => makeGoal(click, key)} disabled={!goals.data || full || adding !== null}>{adding === key ? "Adding…" : "Make this a goal"}</button>}
                </li>
              );
            })}
          </ol>
        )}
        {error && <p className="form-error click-error">{error}</p>}
        {clicks.length > 0 && (
          <div className="panel-foot">
            <button type="button" className="ask-link" onClick={() => askAbout(`What do the clicks on ${pagePath(page)} say about what visitors want there?`)}>Ask about these clicks</button>
          </div>
        )}
      </section>
    </div>
  );
}
