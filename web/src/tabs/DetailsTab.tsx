import type { AnalysisResult, DeviceAnalysis } from "@tracetray/shared";
import { visitorTypes } from "../lib/analysis";
import { groupColors } from "../lib/palette";

function fixed(value: number): string {
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
  const significant = new Set((data.kruskal_wallis || []).filter(k => k.significant === "yes").map(k => k.feature));

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        <div className="end"><span className="ask-note">{data.session_count} visits, {data.k} groups{data.silhouette_score != null && `, silhouette ${data.silhouette_score.toFixed(3)}`}</span></div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr><th>Feature</th>{data.clusters.map(c => <th key={c.id} className="right"><span className="device"><span className="dot" style={{ background: colorOf[c.id] }} />{names[c.id] || `Group ${c.id + 1}`}</span></th>)}<th className="right">Kruskal-Wallis</th></tr>
          </thead>
          <tbody>
            {features.map(feature => {
              const test = data.kruskal_wallis?.find(k => k.feature === feature);
              return (
                <tr key={feature}>
                  <td className={significant.has(feature) ? "strong" : ""}>{feature}</td>
                  {data.clusters.map(c => <td key={c.id} className="right num">{typeof c.feature_means[feature] === "number" ? fixed(c.feature_means[feature] as number) : "–"}</td>)}
                  <td className="right num">{test?.H_statistic != null && test.p_value != null ? `H ${test.H_statistic.toFixed(1)}, p ${test.p_value < 0.001 ? "<0.001" : test.p_value.toFixed(3)}` : "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="panel-foot">Bold features differ between groups at p &lt; 0.05. Names come from comparing each group with the page average.</p>
    </section>
  );
}

export default function DetailsTab({ result }: { result: AnalysisResult }) {
  return (
    <div className="content">
      <p className="tab-intro">The numbers behind the visitor groups, for developers. Groups are found with k-means and checked against hierarchical clustering{result.algorithm_agreement != null && ` (${Math.round(result.algorithm_agreement * 100)}% agreement)`}.</p>
      <Model title="Desktop" data={result} result={result} device="desktop" />
      <Model title="Mobile" data={result.mobile} result={result} device="mobile" />
    </div>
  );
}
