import { percent, type AnalysisResult } from "@tracetray/shared";
import { useApi } from "../api";
import { useSite } from "../state/site";
import { useLoad } from "../lib/useLoad";
import { interpretationOf } from "../lib/analysis";

function mobileDepth(result: AnalysisResult | null): number | null {
  const clusters = result?.mobile?.clusters || [];
  const total = clusters.reduce((sum, c) => sum + c.n, 0);
  if (!total) return null;
  return clusters.reduce((sum, c) => sum + (c.feature_means.scroll_depth_reached ?? c.feature_means.scroll_depth_norm ?? 0) * c.n, 0) / total;
}

export default function AttentionTab({ page, result }: { page: string; result: AnalysisResult | null }) {
  const api = useApi();
  const { siteKey } = useSite();
  const profile = useLoad(() => api.attention(siteKey, page), [api, siteKey, page]);

  if (profile.error) return <div className="content"><p className="page-status error" style={{ padding: 0 }}>{profile.error}</p></div>;
  if (!profile.data) return <p className="loading">Loading…</p>;
  const data = profile.data;
  if (!data.sessions) {
    return <div className="content"><section className="panel"><div className="empty"><b>No cursor data yet</b><p>Attention comes from desktop visits that move the cursor. It shows up after a few of those.</p></div></section></div>;
  }

  const zones = data.zone_breakdown;
  const maxZone = Math.max(zones.top, zones.middle, zones.bottom, 0.01);
  const fi = data.first_impression;
  const early = fi?.early_zone_breakdown;
  const earlyZone = early ? (Object.entries(early) as [string, number][]).sort((a, b) => b[1] - a[1])[0][0] : null;
  const note = interpretationOf(result)?.first_impression_note;
  const phoneDepth = mobileDepth(result);

  return (
    <div className="content">
      <div className="split">
        <section className="panel">
          <div className="panel-head"><h2>Where the cursor spends time</h2><div className="end"><span className="ask-note">{data.sessions.toLocaleString()} desktop visits</span></div></div>
          <div className="panel-body attention">
            <div className="depth" role="img" aria-label="Cursor activity from the top of the page to the bottom">
              {data.depth_profile.map(band => <i key={band.band} style={{ opacity: 0.08 + band.weight * 0.92 }} title={`${Math.round(band.depth * 100)}% down: ${band.count.toLocaleString()} movements`} />)}
              <span className="depth-top">Top of page</span><span className="depth-bottom">Bottom</span>
            </div>
            <div className="zones">
              {([["Top third", zones.top], ["Middle third", zones.middle], ["Bottom third", zones.bottom]] as const).map(([label, value]) => (
                <div key={label} className="zone">
                  <span>{label}</span>
                  <div className="meter"><i style={{ width: `${(value / maxZone) * 100}%` }} /></div>
                  <b className="num">{percent(value)}</b>
                </div>
              ))}
              {data.insight && <p className="muted">{data.insight}</p>}
              <p className="muted">Measured against how far each visitor's own cursor travels, so it holds across screen sizes.</p>
            </div>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>First five seconds</h2></div>
          <div className="panel-body facts">
            <div><b className="num">{fi?.velocity_delta_pct == null ? "–" : `${Math.abs(fi.velocity_delta_pct).toFixed(0)}% ${fi.velocity_delta_pct > 0 ? "faster" : "slower"}`}</b><span>cursor speed than the rest of the visit</span></div>
            <div><b className="num">{fi?.early_pause_count ?? "–"}</b><span>pauses, against {fi?.rest_pause_count ?? "–"} in the rest of the visit</span></div>
            <div><b>{earlyZone ? `${earlyZone.charAt(0).toUpperCase()}${earlyZone.slice(1)} of the page` : "–"}</b><span>where early movement concentrates</span></div>
            {note && <p className="muted">{note}</p>}
          </div>
        </section>
      </div>
      {phoneDepth !== null && (
        <section className="panel">
          <div className="panel-head"><h2>On phones</h2></div>
          <div className="panel-body"><p>Mobile visitors get {percent(phoneDepth)} of the way down this page on average. Phones don't have a cursor, so this comes from scrolling.</p></div>
        </section>
      )}
    </div>
  );
}
