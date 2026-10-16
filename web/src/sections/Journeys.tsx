import type React from "react";
import { pageLabel, percent } from "@tracetray/shared";
import { useApi } from "../api";
import { useSite } from "../state/site";
import { useLoad } from "../lib/useLoad";
import { useAskAbout } from "../lib/askLink";
import ExpectedPaths from "../components/ExpectedPaths";

function pathLabel(path: string): string {
  return path.split(/ -> | → /).map(pageLabel).join(" → ");
}

function Ranked({ title, note, rows, color }: { title: string; note: string; rows: { label: string; count: number }[]; color: string }) {
  const max = Math.max(1, ...rows.map(r => r.count));
  return (
    <section className="panel">
      <div className="panel-head"><h2>{title}</h2><div className="end"><span className="ask-note">{note}</span></div></div>
      {rows.length === 0 ? <p className="empty">Nothing yet.</p> : (
        <ol className="click-list" style={{ "--fill": color } as React.CSSProperties}>
          {rows.map(row => (
            <li key={row.label}>
              <span className="click-text"><b title={row.label}>{row.label}</b></span>
              <span className="meter"><i style={{ width: `${(row.count / max) * 100}%` }} /></span>
              <b className="num">{row.count.toLocaleString()}</b>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default function Journeys() {
  const api = useApi();
  const { siteKey, site } = useSite();
  const askAbout = useAskAbout();
  const journey = useLoad(() => api.journey(siteKey), [api, siteKey]);

  if (journey.error) return <div className="content"><p className="page-status error" style={{ padding: 0 }}>{journey.error}</p></div>;
  if (!journey.data) return <p className="loading">Loading…</p>;
  const data = journey.data;
  const visitors = data.total_visitors || 0;

  return (
    <div className="content">
      <div className="section-head">
        <h1 className="section-title">Journeys</h1>
        <p className="tab-intro">How visitors moved through {site.name} in the last 30 days: where they arrive, where they go next, and where they leave. It follows each visitor across pages, so it covers the whole site.</p>
      </div>
      {visitors === 0 ? (
        <section className="panel"><div className="empty"><b>No journeys yet</b><p>Journeys appear once visitors view more than one page.</p></div></section>
      ) : (
        <>
          <div className="stat-strip">
            <div style={{ "--accent": "var(--d1)" } as React.CSSProperties}><b className="num">{visitors.toLocaleString()}</b><span>visitors</span></div>
            <div style={{ "--accent": "var(--d2)" } as React.CSSProperties}><b className="num">{percent(data.multi_page_visitors / visitors)}</b><span>viewed more than one page</span></div>
            <div style={{ "--accent": "var(--d4)" } as React.CSSProperties}><b className="num">{percent(data.single_page_visitors / visitors)}</b><span>left after one page</span></div>
          </div>
          <div className="split even">
            <Ranked color="var(--d2)" title="Where visitors arrive" note="first page" rows={data.top_entries.map(r => ({ label: pageLabel(r.page), count: r.count }))} />
            <Ranked color="var(--d4)" title="Where visitors leave" note="last page" rows={data.top_exits.map(r => ({ label: pageLabel(r.page), count: r.count }))} />
          </div>
          <Ranked color="var(--d1)" title="Most common moves" note="from one page to the next" rows={data.top_transitions.map(r => ({ label: pathLabel(r.path), count: r.count }))} />
          <Ranked color="var(--d5)" title="Most common paths" note="first three pages" rows={data.top_paths.map(r => ({ label: pathLabel(r.path), count: r.count }))} />
          <p><button type="button" className="ask-link" onClick={() => askAbout("Where do people leave the site, and what could keep them going?")}>Ask where visitors drop off</button></p>
        </>
      )}
      <ExpectedPaths />
    </div>
  );
}
