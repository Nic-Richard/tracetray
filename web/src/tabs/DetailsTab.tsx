import type { AnalysisResult, DeviceAnalysis } from "@tracetray/shared";
import { visitorTypes } from "../lib/analysis";
import { groupColors } from "../lib/palette";

const UNITS: Record<string, string> = {
  pause_rate: "per s", click_rate: "per s", move_density: "per s", direction_change_rate: "per s", scroll_burst_rate: "per s",
  tap_rate: "per s", attention_pause_rate: "per s", distance_per_move: "px", avg_cursor_velocity: "px/ms",
  scroll_velocity_rate: "px/ms", dwell_before_click: "ms", dwell_before_tap: "ms", avg_attention_pause_ms: "ms",
  spatial_entropy: "bits", top_zone_ratio: "share", centre_zone_ratio: "share", bottom_zone_ratio: "share", scroll_depth_reached: "share"
};

const STRUCTURE: Record<string, string> = {
  clear: "Clear groups: well separated, and stable when re-run on samples of the data.",
  some: "Overlapping groups: real, but the lines between them are soft.",
  none: "No reliable groups: no split separated visitors better than groupless data would, or the split changed from sample to sample. The dashboard treats these visitors as one."
};

function fixed(value: number, feature: string): string {
  if (UNITS[feature] === "share") return `${(value * 100).toFixed(0)}%`;
  const size = Math.abs(value);
  return value.toFixed(size >= 100 ? 0 : size >= 1 ? 2 : 3);
}

function Model({ title, data, result, device }: { title: string; data: DeviceAnalysis | null | undefined; result: AnalysisResult; device: "desktop" | "mobile" }) {
  if (!data?.clusters?.length) return null;
  const features = Object.keys(data.clusters[0].feature_means || {});
  const types = visitorTypes(result, device);
  const colors = groupColors(types.map(t => t.key));
  const names = Object.fromEntries(types.map(t => [t.id, t.headline]));
  const colorOf = Object.fromEntries(types.map((t, i) => [t.id, colors[i]]));
  const ordered = types.map(t => data.clusters.find(c => c.id === t.id)!).filter(Boolean);
  const significant = new Set((data.kruskal_wallis || []).filter(k => k.significant === "yes").map(k => k.feature));
  const used = data.k_rationale?.features_used as string[] | undefined;
  const nullSilhouette = data.k_rationale?.null_silhouette_max as number | undefined;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        <div className="end"><span className="ask-note">
          {data.session_count.toLocaleString()} visits, {data.k} groups
          {data.silhouette_score != null && `, silhouette ${data.silhouette_score.toFixed(2)}`}
          {nullSilhouette != null && ` (groupless data up to ${nullSilhouette.toFixed(2)})`}
          {data.stability != null && `, stability ${data.stability.toFixed(2)}`}
        </span></div>
      </div>
      {data.structure && <p className="panel-note">{STRUCTURE[data.structure]}</p>}
      <div className="table-scroll">
        <table className="details-table">
          <thead>
            <tr><th>Feature</th>{ordered.map(c => <th key={c.id} className="right"><span className="device"><span className="dot" style={{ background: colorOf[c.id] }} />{names[c.id] || `Group ${c.id + 1}`}</span></th>)}<th className="right">Effect size</th></tr>
          </thead>
          <tbody>
            {features.map(feature => {
              const test = data.kruskal_wallis?.find(k => k.feature === feature);
              const unused = used && !used.includes(feature);
              return (
                <tr key={feature} className={unused ? "unused" : ""} title={unused ? "Not used to form the groups: it didn't vary, or repeats another feature" : undefined}>
                  <td className={significant.has(feature) ? "strong" : ""}>{feature} <small className="muted">{UNITS[feature]}</small></td>
                  {ordered.map(c => <td key={c.id} className="right num">{typeof c.feature_means[feature] === "number" ? fixed(c.feature_means[feature] as number, feature) : "–"}</td>)}
                  <td className="right num">{test?.effect_size != null ? test.effect_size.toFixed(2) : "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="panel-foot">Bold features differ clearly between groups (Kruskal-Wallis effect size ε² of 0.08 or more). Greyed features weren't used to form the groups. Waits before a click or tap average only the visits that clicked or tapped.</p>
    </section>
  );
}

export default function DetailsTab({ result }: { result: AnalysisResult }) {
  return (
    <div className="content">
      <p className="tab-intro">The numbers behind the visitor groups, for developers. Groups are found with k-means on log-scaled, standardized features, using the fewest groups that separate visitors about as well as any larger number, up to five{result.algorithm_agreement != null && `. Hierarchical clustering agrees on ${Math.round(result.algorithm_agreement * 100)}% of desktop visits`}.</p>
      <Model title="Desktop" data={result} result={result} device="desktop" />
      <Model title="Mobile" data={result.mobile} result={result} device="mobile" />
    </div>
  );
}
