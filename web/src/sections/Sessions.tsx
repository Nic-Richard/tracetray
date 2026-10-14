import { pageLabel, timeAgo } from "@tracetray/shared";
import { useApi } from "../api";
import { useSite } from "../state/site";
import { useLoad } from "../lib/useLoad";

function duration(ms: number | undefined): string {
  if (!ms || ms < 0) return "–";
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

export default function Sessions() {
  const api = useApi();
  const { siteKey, site } = useSite();
  const sessions = useLoad(() => api.recentSessions(siteKey, 50), [api, siteKey]);

  return (
    <div className="content">
      <div className="section-head">
        <h1 className="section-title">Recent visits</h1>
        <p className="tab-intro">The 50 most recent visits to {site.name}, newest first. Each visit to a page counts once.</p>
      </div>
      {sessions.error && <p className="page-status error" style={{ padding: 0 }}>{sessions.error}</p>}
      {!sessions.data && !sessions.error && <p className="loading">Loading…</p>}
      {sessions.data && (
        <section className="panel">
          {sessions.data.length === 0 ? <p className="empty">No finished visits yet.</p> : (
            <div className="table-scroll">
              <table>
                <thead><tr><th>When</th><th>Page</th><th>Device</th><th className="right">Time on page</th><th className="right hide-sm">Clicks or taps</th></tr></thead>
                <tbody>
                  {sessions.data.map(s => (
                    <tr key={s.session_id}>
                      <td>{timeAgo(s.start_time)}</td>
                      <td><span className="cell-page"><span title={s.page}>{pageLabel(s.page)}</span></span></td>
                      <td><span className="device"><span className="dot" style={{ background: s.device_type === "mobile" ? "var(--mobile)" : "var(--desktop)" }} />{s.device_type === "mobile" ? "Phone" : "Desktop"}</span></td>
                      <td className="right num">{duration(s.summary?.duration_ms)}</td>
                      <td className="right num hide-sm">{(s.device_type === "mobile" ? s.summary?.taps : s.summary?.clicks) ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
