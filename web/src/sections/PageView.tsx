import { useState } from "react";
import { NavLink, useLocation, useParams } from "react-router";
import { compactNumber, isPageGroup, pageLabel, pagePath, timeAgo, type Stats, type Timeseries } from "@tracetray/shared";
import { useApi } from "../api";
import { useSite } from "../state/site";
import { useLoad } from "../lib/useLoad";
import { heatColor } from "../lib/heat";
import GroupPages from "../components/GroupPages";
import WhoVisits from "../components/WhoVisits";
import TrafficPanel from "../components/TrafficPanel";
import SummaryPanel from "../components/SummaryPanel";
import Icon from "../components/Icon";
import NotMovedYet from "../components/NotMovedYet";

const TABS = [
  { key: "", label: "Overview" },
  { key: "visitors", label: "Visitors" },
  { key: "attention", label: "Attention" },
  { key: "clicks", label: "Clicks" },
  { key: "trends", label: "Trends" }
];

function subline(timeseries: Timeseries | null, groupSize: number | undefined): string {
  if (!timeseries) return "";
  const visits = timeseries.total_sessions;
  const desktop = timeseries.series.reduce((sum, day) => sum + day.desktop, 0);
  const across = groupSize ? ` across ${groupSize.toLocaleString()} pages` : "";
  if (!visits) return `No visits in the last 30 days${across}.`;
  return `${visits.toLocaleString()} visit${visits === 1 ? "" : "s"} in the last 30 days${across}. ${Math.round((desktop / visits) * 100)}% on desktop.`;
}

function Overview({ page, stats, timeseries, groupSize, onRefresh, refreshing }: {
  page: string; stats: Stats; timeseries: Timeseries | null; groupSize?: number; onRefresh: () => void; refreshing: boolean;
}) {
  const result = stats.last_analysis;
  const group = isPageGroup(page);
  return (
    <div className="content">
      <div className="split">
        {group ? <GroupPages page={page} groupSize={groupSize || 0} /> : timeseries ? <TrafficPanel timeseries={timeseries} /> : <section className="panel"><p className="empty">Loading visits…</p></section>}
        {result ? <WhoVisits result={result} page={page} /> : (
          <section className="panel">
            <div className="empty">
              <b>No analysis yet</b>
              <p>{stats.analysable_sessions >= 16
                ? "Refresh the analysis to sort this page's visitors into groups."
                : `TraceTray needs 16 visits with real interaction to sort visitors into groups. This page has ${stats.analysable_sessions}.`}</p>
              {stats.analysable_sessions >= 16 && <p style={{ marginTop: 12 }}><button type="button" className="btn primary" onClick={onRefresh} disabled={refreshing}>Refresh analysis</button></p>}
            </div>
          </section>
        )}
      </div>
      {result && <SummaryPanel result={result} page={page} />}
    </div>
  );
}

export default function PageView({ onPickPage }: { onPickPage: () => void }) {
  const api = useApi();
  const { siteKey, page, pages, reloadPages } = useSite();
  const { tab = "" } = useParams();
  const { search } = useLocation();
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const stats = useLoad(() => (page ? api.stats(siteKey, page) : null), [api, siteKey, page]);
  const timeseries = useLoad(() => (page ? api.timeseries(siteKey, page, 30) : null), [api, siteKey, page]);

  if (!pages) return <p className="loading">Loading…</p>;
  if (!page) {
    return (
      <div className="placeholder-section">
        <h1>No pages yet</h1>
        <p>Add the tracking snippet from Setup to your site. Pages show up here as soon as someone visits.</p>
      </div>
    );
  }

  const summary = pages.find(p => p.page === page);
  const max = Math.max(1, ...pages.map(p => p.sessions));
  const label = pageLabel(page);
  const path = pagePath(page);

  async function refresh() {
    if (!page) return;
    setRefreshing(true);
    setStatus({ text: "Analysing visits…" });
    try {
      const permit = await api.analysisPermit(siteKey, "page");
      const run = await api.runAnalysis(siteKey, permit.permit_token, page);
      const failure = run.result.failure;
      setStatus(failure
        ? { text: failure.message || `Not enough visits to sort into groups yet (have ${failure.have ?? 0}, need ${failure.needed ?? 16}).` }
        : { text: `Updated. ${permit.remaining_free_today} more refresh${permit.remaining_free_today === 1 ? "" : "es"} for this site today.` });
      stats.reload();
      reloadPages();
    } catch (err) {
      setStatus({ text: err instanceof Error ? err.message.charAt(0).toUpperCase() + err.message.slice(1) : "The analysis didn't finish.", error: true });
    } finally {
      setRefreshing(false);
    }
  }

  const lastRun = stats.data?.last_analysis?.ran_at;
  return (
    <>
      <button type="button" className="page-pick" onClick={onPickPage}>
        <span className="heat" style={{ background: heatColor(summary?.sessions || 0, max) }} />
        <div><b>{label}</b><small>{summary?.pages_in_group ? `${path}, ${summary.pages_in_group.toLocaleString()} pages` : path}</small></div>
        <Icon name="chevron" size={14} />
      </button>
      <div className="page-top">
        <h1>{label}</h1>
        {label !== path && <code>{path}</code>}
        <div className="page-actions">
          {lastRun && <span className="ask-note">Analysed {timeAgo(lastRun)}</span>}
          <button type="button" className="btn primary" onClick={refresh} disabled={refreshing}>{refreshing ? "Analysing…" : "Refresh analysis"}</button>
        </div>
      </div>
      <p className="page-sub">{subline(timeseries.data, summary?.pages_in_group) || `${compactNumber(summary?.sessions || 0)} visits so far.`}</p>
      {status && <p className={`page-status${status.error ? " error" : ""}`} role="status">{status.text}</p>}
      <nav className="tabs" aria-label="Page views">
        {TABS.map(item => (
          <NavLink key={item.key} end to={{ pathname: `/pages${item.key ? `/${item.key}` : ""}`, search }} className={({ isActive }) => `tab${isActive ? " active" : ""}`}>
            {item.label}
          </NavLink>
        ))}
      </nav>
      {stats.error && <p className="page-status error">{stats.error}</p>}
      {!stats.data && !stats.error && <p className="loading">Loading…</p>}
      {stats.data && tab === "" && (
        <Overview page={page} stats={stats.data} timeseries={timeseries.data} groupSize={summary?.pages_in_group} onRefresh={refresh} refreshing={refreshing} />
      )}
      {stats.data && tab !== "" && <NotMovedYet title={TABS.find(t => t.key === tab)?.label || "This view"} />}
    </>
  );
}
