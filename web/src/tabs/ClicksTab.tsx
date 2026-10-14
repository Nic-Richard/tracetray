import type React from "react";
import { pagePath, type ClickCount } from "@tracetray/shared";
import { useAskAbout } from "../lib/askLink";

const TAGS: Record<string, string> = { a: "Link", button: "Button", input: "Input", img: "Image", select: "Menu", label: "Label" };

export default function ClicksTab({ clicks, page }: { clicks: ClickCount[]; page: string }) {
  const askAbout = useAskAbout();
  const max = Math.max(1, ...clicks.map(c => c.count));

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
          <ol className="click-list" style={{ "--fill": "var(--d3)" } as React.CSSProperties}>
            {clicks.map(click => (
              <li key={`${click.tag}:${click.text}`}>
                <span className="click-text"><b title={click.text}>{click.text}</b><small>{TAGS[click.tag?.toLowerCase()] || click.tag}</small></span>
                <span className="meter"><i style={{ width: `${(click.count / max) * 100}%` }} /></span>
                <b className="num">{click.count.toLocaleString()}</b>
              </li>
            ))}
          </ol>
        )}
        {clicks.length > 0 && (
          <div className="panel-foot">
            <button type="button" className="ask-link" onClick={() => askAbout(`What do the clicks on ${pagePath(page)} say about what visitors want there?`)}>Ask about these clicks</button>
          </div>
        )}
      </section>
    </div>
  );
}
