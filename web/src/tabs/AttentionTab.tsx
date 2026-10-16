import type React from "react";
import { percent, type AnalysisResult } from "@tracetray/shared";
import { useApi } from "../api";
import { useSite } from "../state/site";
import { useLoad } from "../lib/useLoad";
import { interpretationOf } from "../lib/analysis";
import PagePicture, { usePageShot } from "../components/PagePicture";

function phoneMean(result: AnalysisResult | null, ...features: string[]): number | null {
  const clusters = (result?.mobile?.clusters || []).filter(c => features.some(f => typeof c.feature_means[f] === "number"));
  const total = clusters.reduce((sum, c) => sum + c.n, 0);
  if (!total) return null;
  return clusters.reduce((sum, c) => sum + (features.map(f => c.feature_means[f]).find(v => typeof v === "number") ?? 0) * c.n, 0) / total;
}

export default function AttentionTab({ page, result }: { page: string; result: AnalysisResult | null }) {
  const api = useApi();
  const { siteKey } = useSite();
  const profile = useLoad(() => api.attention(siteKey, page), [api, siteKey, page]);
  const desktopShot = usePageShot(page, "desktop", profile.data?.shots?.desktop);
  const phoneShot = usePageShot(page, "mobile", profile.data?.shots?.mobile);

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
  const phoneDepth = phoneMean(result, "scroll_depth_reached", "scroll_depth_norm");
  const phoneTaps = phoneMean(result, "tap_rate");
  const phonePause = phoneMean(result, "avg_attention_pause_ms");
  const phoneVisits = (result?.mobile?.clusters || []).reduce((sum, c) => sum + c.n, 0);
  const goalAt = (device: "desktop" | "mobile") => {
    const depth = result?.goal?.position?.[device];
    return result?.goal && typeof depth === "number" ? { name: result.goal.name, depth } : null;
  };

  return (
    <div className="content">
      <section className="panel">
        <div className="panel-head"><h2>Where the cursor spends time</h2><div className="end"><span className="ask-note">{data.sessions.toLocaleString()} desktop visits</span></div></div>
        <div className={`panel-body attention${desktopShot && data.shots?.desktop ? " pictured" : ""}`}>
          <div className="depth-col">
          {desktopShot && data.shots?.desktop ? (
            <PagePicture src={desktopShot} info={data.shots.desktop} bands={data.depth_profile.map(b => b.weight)} color="var(--d1)"
              reach={data.reach?.desktop} goal={goalAt("desktop")} label="Cursor activity shaded over a picture of the page" />
          ) : (
            <div className="depth" role="img" aria-label="Cursor activity from the top of the page to the bottom">
              {data.depth_profile.map(band => <i key={band.band} style={{ opacity: 0.08 + band.weight * 0.92 }} title={`${Math.round(band.depth * 100)}% down: ${percent(band.share)} of cursor activity`} />)}
              <span className="depth-top">Top of page</span><span className="depth-bottom">Bottom</span>
            </div>
          )}
          <div className="depth-legend" aria-hidden="true"><small>Cursor activity</small><span>Less</span><i /><span>More</span></div>
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
            {data.reach?.desktop && (
              <div className="reach-facts">
                <div><b className="num">{percent(data.reach.desktop.p50)}</b><span>of the way down, reached by half of visits</span></div>
                {data.reach.desktop.fold != null && <div><b className="num">{percent(data.reach.desktop.fold)}</b><span>of the page fits on a typical first screen</span></div>}
              </div>
            )}
            <p className="muted">Measured as a share of each page's full height, with every visit counting equally.{desktopShot && data.shots?.desktop && ` Picture taken ${new Date(data.shots.desktop.taken_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })} at 1,280 pixels wide.`}</p>
          </div>
        </div>
      </section>
        <section className="panel">
          <div className="panel-head"><h2>First five seconds</h2></div>
          <div className="panel-body facts">
            {fi?.velocity_delta_pct != null && <div style={{ "--fill": "var(--d1)" } as React.CSSProperties}><b className="num">{Math.abs(fi.velocity_delta_pct) < 10 ? "About the same" : `${Math.abs(fi.velocity_delta_pct).toFixed(0)}% ${fi.velocity_delta_pct > 0 ? "faster" : "slower"}`}</b><span>cursor speed than later in the visit</span></div>}
            {fi?.early_pauses_per_min != null && fi.rest_pauses_per_min != null && <div style={{ "--fill": "var(--d2)" } as React.CSSProperties}><b className="num">{fi.early_pauses_per_min.toFixed(1)}</b><span>pauses a minute, against {fi.rest_pauses_per_min.toFixed(1)} later in the visit</span></div>}
            {earlyZone && <div style={{ "--fill": "var(--d3)" } as React.CSSProperties}><b>{`${earlyZone.charAt(0).toUpperCase()}${earlyZone.slice(1)} third of the page`}</b><span>where early movement concentrates</span></div>}
            {note && <p className="muted">{note}</p>}
          </div>
        </section>
      {phoneDepth !== null && (
        <section className="panel">
          <div className="panel-head"><h2>On phones</h2><div className="end"><span className="ask-note">{phoneVisits.toLocaleString()} phone visits</span></div></div>
          <div className={`panel-body phone-attention${phoneShot && data.shots?.mobile ? " pictured" : ""}`}>
            {phoneShot && data.shots?.mobile ? (
              <PagePicture src={phoneShot} info={data.shots.mobile} bands={data.phone_reading?.bands || []} color="var(--mobile)"
                reach={data.reach?.mobile} goal={goalAt("mobile")} label="Where phone visitors stop to read, shaded over a picture of the page" />
            ) : (
              <div className="phone-depth" role="img" aria-label={`Phone visitors get ${percent(phoneDepth)} of the way down on average`}>
                <i style={{ height: percent(phoneDepth) }} />
                <span>{percent(phoneDepth)}</span>
              </div>
            )}
            <div className="facts">
              <div style={{ "--fill": "var(--mobile)" } as React.CSSProperties}><b className="num">{percent(phoneDepth)}</b><span>of the way down the page, on average</span></div>
              {phoneTaps !== null && <div style={{ "--fill": "var(--d3)" } as React.CSSProperties}><b className="num">{(phoneTaps * 60).toFixed(1)}</b><span>taps a minute</span></div>}
              {phonePause !== null && phonePause > 0 && <div style={{ "--fill": "var(--d4)" } as React.CSSProperties}><b className="num">{(phonePause / 1000).toFixed(1)} s</b><span>a typical stop to read before scrolling on</span></div>}
              <p className="muted">Phones don't have a cursor, so this comes from scrolling, taps and the moments people stop to read.{phoneShot && data.shots?.mobile && " The shading shows where they stop."}</p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
