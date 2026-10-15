import { useEffect, useRef, useState } from "react";
import type React from "react";
import { Link, NavLink, useLocation, useParams } from "react-router";
import { compactNumber, isPageGroup, pageLabel, pagePath, percent, timeAgo, type AnalysisResult, type Stats, type Timeseries } from "@tracetray/shared";
import { useApi } from "../api";
import { useSite } from "../state/site";
import { useLoad } from "../lib/useLoad";
import { heatColor } from "../lib/heat";
import { readSession, writeSession } from "../lib/storage";
import { interpretationOf, visitorTypes } from "../lib/analysis";
import { groupColors } from "../lib/palette";
import GroupPages from "../components/GroupPages";
import WhoVisits from "../components/WhoVisits";
import TrafficPanel from "../components/TrafficPanel";
import SummaryPanel from "../components/SummaryPanel";
import Icon from "../components/Icon";
import VisitorsTab from "../tabs/VisitorsTab";
import AttentionTab from "../tabs/AttentionTab";
import ClicksTab from "../tabs/ClicksTab";
import TrendsTab from "../tabs/TrendsTab";
import DetailsTab from "../tabs/DetailsTab";
import GoalLine from "../components/GoalLine";

const MIN_SESSIONS = 16;

const TABS = [
  { key: "", label: "Overview" },
  { key: "visitors", label: "Visitors" },
  { key: "attention", label: "Attention" },
  { key: "clicks", label: "Clicks" },
  { key: "trends", label: "Trends" },
  { key: "details", label: "Details" }
];

function subline(timeseries: Timeseries | null, groupSize: number | undefined): string {
  if (!timeseries) return "";
  const visits = timeseries.total_sessions;
  const across = groupSize ? ` across ${groupSize.toLocaleString()} pages` : "";
  if (!visits) return `No visits in the last 30 days${across}.`;
  return `${visits.toLocaleString()} visit${visits === 1 ? "" : "s"} in the last 30 days${across}.`;
}

/** Why a page can't be sorted into visitor groups yet, in the page's own numbers. */
function readiness(stats: Stats): string {
  const total = stats.total_sessions;
  const active = stats.analysable_sessions;
  if (total === 0) return "Nobody has visited this page yet.";
  const counted = `${total.toLocaleString()} visit${total === 1 ? "" : "s"} so far, and ${active === total ? "all" : active.toLocaleString()} of them involved moving the cursor, clicking, tapping or scrolling`;
  if (active >= MIN_SESSIONS) return `This page has ${counted}. That's enough to sort visitors into groups.`;
  return `This page has ${counted}. TraceTray studies those to sort visitors into groups, and needs at least ${MIN_SESSIONS}.`;
}

function Figure({ value, label, note, accent }: { value: string; label: string; note?: string; accent: string }) {
  return (
    <div className="figure" style={{ "--accent": accent } as React.CSSProperties}>
      <span>{label}</span>
      <b className="num">{value}</b>
      {note && <small>{note}</small>}
    </div>
  );
}

function matchesPattern(path: string, pattern: string): boolean {
  const parts = path.split("/").filter(Boolean);
  const rule = pattern.split("/").filter(Boolean);
  return parts.length === rule.length && rule.every((segment, i) => segment.startsWith(":") || segment === parts[i]);
}

function GroupingNudge({ page }: { page: string }) {
  const api = useApi();
  const { siteKey } = useSite();
  const { search } = useLocation();
  const dismissKey = `tracetray.nudge-dismissed.${siteKey}`;
  const [dismissed, setDismissed] = useState(() => readSession(dismissKey) === "1");
  const groups = useLoad(() => api.pageGroups(siteKey), [api, siteKey]);
  const match = isPageGroup(page) ? undefined : groups.data?.suggestions.find(s => matchesPattern(pagePath(page), s.pattern));
  if (!match || dismissed) return null;
  return (
    <div className="nudge">
      <div>
        <b>This page could be part of a group</b>
        <p>{match.pages.toLocaleString()} pages follow the pattern <code>{match.pattern}</code>. Grouping them gives you one view of all of them, with enough visits to sort into visitor groups sooner.</p>
      </div>
      <Link className="btn" to={{ pathname: "/setup", search }}>Review the suggestion</Link>
      <button type="button" className="nudge-close" aria-label="Hide this suggestion until your next visit" onClick={() => { writeSession(dismissKey, "1"); setDismissed(true); }}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

function DevicePanel({ timeseries, result }: { timeseries: Timeseries; result: AnalysisResult | null }) {
  const desktop = timeseries.series.reduce((sum, d) => sum + d.desktop, 0);
  const mobile = timeseries.series.reduce((sum, d) => sum + d.mobile, 0);
  const total = desktop + mobile;
  if (!total) return null;
  const phoneTypes = visitorTypes(result, "mobile");
  const phoneColors = groupColors(phoneTypes.map(t => t.key));
  const comparison = interpretationOf(result)?.device_comparison;
  return (
    <section className="panel">
      <div className="panel-head"><h2>Desktop and phones</h2></div>
      <div className="panel-body devices">
        <div className="device-split">
          <div className="device-bar" role="img" aria-label={`${percent(desktop / total)} desktop, ${percent(mobile / total)} phones`}>
            <span style={{ flex: desktop, background: "var(--desktop)" }} />
            <span style={{ flex: mobile, background: "var(--mobile)" }} />
          </div>
          <div className="device-counts">
            <div style={{ "--fill": "var(--desktop)" } as React.CSSProperties}><b className="num">{percent(desktop / total)}</b><span>{desktop.toLocaleString()} desktop visits</span></div>
            <div style={{ "--fill": "var(--mobile)" } as React.CSSProperties}><b className="num">{percent(mobile / total)}</b><span>{mobile.toLocaleString()} phone visits</span></div>
          </div>
        </div>
        <div className="device-notes">
          {comparison && <p>{comparison}</p>}
          {phoneTypes.length > 0 && (
            <div className="group-chips" aria-label="Phone visitor groups">
              {phoneTypes.map((type, i) => <span key={type.id}><i style={{ background: phoneColors[i] }} />{type.headline} <b className="num">{Math.round(type.share * 100)}%</b></span>)}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Overview({ page, stats, timeseries, groupSize, onRefresh, refreshing }: {
  page: string; stats: Stats; timeseries: Timeseries | null; groupSize?: number; onRefresh: () => void; refreshing: boolean;
}) {
  const result = stats.last_analysis;
  const group = isPageGroup(page);
  const visits = timeseries?.total_sessions ?? 0;
  const desktopShare = visits ? timeseries!.series.reduce((sum, d) => sum + d.desktop, 0) / visits : null;
  const groups = result?.clusters?.length || 0;
  const phoneGroups = result?.mobile?.clusters?.length || 0;

  return (
    <div className="content">
      <div className="figures">
        <Figure accent="var(--d1)" label="Visits, last 30 days" value={timeseries ? compactNumber(visits) : "–"} note={desktopShare === null ? undefined : `${percent(desktopShare)} on desktop`} />
        <Figure accent="var(--d2)" label="Engaged visits" value={timeseries && visits ? percent(timeseries.engagement_rate) : "–"} note="Stayed over 5 seconds and did something" />
        <Figure accent="var(--d5)" label="Visitor groups" value={groups + phoneGroups ? String(groups + phoneGroups) : "–"} note={result ? `${groups} on desktop, ${phoneGroups} on phones` : "Not analyzed yet"} />
        {group
          ? <Figure accent="var(--d3)" label="Pages in this group" value={compactNumber(groupSize || 0)} note={pagePath(page)} />
          : <Figure accent="var(--d3)" label="Last analyzed" value={result ? timeAgo(result.ran_at) : "Never"} note={result ? "Refresh after you change the page" : undefined} />}
      </div>
      <GroupingNudge page={page} />
      <div className="split">
        {group ? <GroupPages page={page} groupSize={groupSize || 0} /> : timeseries ? <TrafficPanel timeseries={timeseries} /> : <section className="panel"><p className="empty">Loading visits…</p></section>}
        {result ? <WhoVisits result={result} page={page} /> : (
          <section className="panel">
            <div className="empty">
              <b>No visitor groups yet</b>
              <p>{readiness(stats)}</p>
              {stats.analysable_sessions >= MIN_SESSIONS && <p style={{ marginTop: 14 }}><button type="button" className="btn primary" onClick={onRefresh} disabled={refreshing}>Analyze this page</button></p>}
            </div>
          </section>
        )}
      </div>
      {timeseries && <DevicePanel timeseries={timeseries} result={result} />}
      {result && <SummaryPanel result={result} page={page} />}
    </div>
  );
}

function LockedPage() {
  const month = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1))
    .toLocaleDateString(undefined, { month: "long", day: "numeric", timeZone: "UTC" });
  return (
    <div className="content">
      <section className="panel locked-panel">
        <Icon name="lock" size={22} />
        <h2>This page is past your plan's page limit</h2>
        <p>TraceTray is still collecting its visits, so nothing is lost. It opens again on {month}, or as soon as you move to a plan with more pages.</p>
        <p><a className="btn primary" href="/pricing">See plans</a></p>
      </section>
    </div>
  );
}

function MoreMenu({ onRefreshAll, onReset, busy }: { onRefreshAll: () => void; onReset: () => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div className="more" ref={ref}>
      <button type="button" className="btn" onClick={() => setOpen(o => !o)} aria-expanded={open} disabled={busy}>More</button>
      {open && (
        <div className="menu menu-right" role="menu">
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onRefreshAll(); }}>Refresh all pages</button>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onReset(); }}>Clear this page's history</button>
        </div>
      )}
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
  const [confirmReset, setConfirmReset] = useState(false);

  const locked = !!pages?.find(p => p.page === page)?.locked;
  const stats = useLoad(() => (page && !locked ? api.stats(siteKey, page) : null), [api, siteKey, page, locked]);
  const timeseries = useLoad(() => (page && !locked ? api.timeseries(siteKey, page, 30) : null), [api, siteKey, page, locked]);

  if (!pages) return <p className="loading">Loading…</p>;
  if (!page) {
    return (
      <div className="placeholder-section">
        <h1>No pages yet</h1>
        <p>Add the tracking snippet from Setup to your site. Pages show up here as soon as someone visits.</p>
        <p><Link className="btn primary" to={{ pathname: "/setup", search }}>Get the snippet</Link></p>
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
    setStatus({ text: "Analyzing visits…" });
    try {
      const permit = await api.analysisPermit(siteKey, "page");
      const run = await api.runAnalysis(siteKey, permit.permit_token, page);
      const failure = run.result.failure;
      setStatus(failure
        ? { text: failure.message || `Not enough visits to sort into groups yet (${failure.have ?? 0} of the ${failure.needed ?? MIN_SESSIONS} needed).` }
        : { text: `Updated. ${permit.remaining_free_today} more refresh${permit.remaining_free_today === 1 ? "" : "es"} for this site today.` });
      stats.reload();
      reloadPages();
    } catch (err) {
      setStatus({ text: err instanceof Error ? err.message.charAt(0).toUpperCase() + err.message.slice(1) : "The analysis didn't finish.", error: true });
    } finally {
      setRefreshing(false);
    }
  }

  async function refreshAll() {
    const eligible = (pages || []).filter(p => p.analysable >= MIN_SESSIONS && !p.locked);
    if (!eligible.length) { setStatus({ text: `No page has ${MIN_SESSIONS} visits with movement, clicks or scrolling yet.`, error: true }); return; }
    setRefreshing(true);
    try {
      const permit = await api.analysisPermit(siteKey, "all", eligible.length);
      for (let i = 0; i < eligible.length; i++) {
        setStatus({ text: `Analyzing ${i + 1} of ${eligible.length}: ${pageLabel(eligible[i].page)}` });
        await api.runAnalysis(siteKey, permit.permit_token, eligible[i].page);
      }
      setStatus({ text: `Refreshed ${eligible.length} page${eligible.length === 1 ? "" : "s"}.` });
      stats.reload();
      reloadPages();
    } catch (err) {
      setStatus({ text: err instanceof Error ? err.message.charAt(0).toUpperCase() + err.message.slice(1) : "The refresh stopped.", error: true });
    } finally {
      setRefreshing(false);
    }
  }

  async function resetHistory() {
    if (!page) return;
    setRefreshing(true);
    try {
      const result = await api.resetPage(siteKey, page);
      setStatus({ text: `Cleared ${result.deleted_sessions.toLocaleString()} visits from ${label}. New visits start a fresh history.` });
      setConfirmReset(false);
      reloadPages();
    } catch (err) {
      setStatus({ text: err instanceof Error ? err.message : "The history wasn't cleared.", error: true });
    } finally {
      setRefreshing(false);
    }
  }

  const lastRun = stats.data?.last_analysis?.ran_at;
  return (
    <>
      <header className="masthead">
        <div className="frame">
          <button type="button" className="page-pick" onClick={onPickPage}>
            <span className="heat" style={{ background: heatColor(summary?.sessions || 0, max) }} />
            <div><b>{label}</b><small>{summary?.pages_in_group ? `${path}, ${summary.pages_in_group.toLocaleString()} pages` : path}</small></div>
            <Icon name="chevron" size={14} />
          </button>
          <div className="page-top">
            <h1>{label}</h1>
            {label !== path && <code>{path}</code>}
            {!locked && <div className="page-actions">
              {lastRun && <span className="ask-note">Analyzed {timeAgo(lastRun)}</span>}
              <MoreMenu onRefreshAll={refreshAll} onReset={() => setConfirmReset(true)} busy={refreshing} />
              <button type="button" className="btn primary" onClick={refresh} disabled={refreshing}>{refreshing ? "Analyzing…" : "Refresh analysis"}</button>
            </div>}
          </div>
          {confirmReset && (
            <div className="confirm page-confirm">
              <p>Clear every visit and analysis recorded for {label}? Do this after a redesign so old behaviour doesn't mix with new. It can't be undone.</p>
              <div className="site-actions">
                <button type="button" className="btn danger" onClick={resetHistory} disabled={refreshing}>Clear history</button>
                <button type="button" className="btn" onClick={() => setConfirmReset(false)} disabled={refreshing}>Keep it</button>
              </div>
            </div>
          )}
          <p className="page-sub">{subline(timeseries.data, summary?.pages_in_group) || `${compactNumber(summary?.sessions || 0)} visit${summary?.sessions === 1 ? "" : "s"} so far.`}</p>
          {page && !locked && <GoalLine key={page} page={page} />}
          {status && <p className={`page-status${status.error ? " error" : ""}`} role="status">{status.text}</p>}
          <nav className="tabs" aria-label="Page views">
            {TABS.map(item => (
              <NavLink key={item.key} end to={{ pathname: `/pages${item.key ? `/${item.key}` : ""}`, search }} className={({ isActive }) => `tab${isActive ? " active" : ""}`}>
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <div className="frame">
        {locked && <LockedPage />}
        {stats.error && <p className="page-status error">{stats.error}</p>}
        {!locked && !stats.data && !stats.error && <p className="loading">Loading…</p>}
        {stats.data && tab === "" && (
          <Overview page={page} stats={stats.data} timeseries={timeseries.data} groupSize={summary?.pages_in_group} onRefresh={refresh} refreshing={refreshing} />
        )}
        {stats.data && (tab === "visitors" || tab === "details") && !stats.data.last_analysis && (
          <div className="content"><section className="panel"><div className="empty"><b>No visitor groups yet</b><p>{readiness(stats.data)}</p></div></section></div>
        )}
        {stats.data?.last_analysis && tab === "visitors" && <VisitorsTab result={stats.data.last_analysis} page={page} />}
        {stats.data?.last_analysis && tab === "details" && <DetailsTab result={stats.data.last_analysis} />}
        {stats.data && tab === "attention" && <AttentionTab page={page} result={stats.data.last_analysis} />}
        {stats.data && tab === "clicks" && <ClicksTab clicks={stats.data.click_summary} page={page} />}
        {stats.data && tab === "trends" && <TrendsTab page={page} />}
      </div>
    </>
  );
}
