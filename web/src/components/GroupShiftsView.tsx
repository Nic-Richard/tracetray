import { useState } from "react";
import { groupColorSlots, measureName, percent, shiftSentences, type Device, type DeviceShifts, type GroupShifts } from "@tracetray/shared";
import GroupMap from "./GroupMap";

const W = 640, H = 200;
const HUES = ["--d1", "--d2", "--d3", "--d4", "--d5", "--d6", "--d-neutral"];
const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

function Stream({ shifts, hues }: { shifts: DeviceShifts; hues: string[] }) {
  const bins = shifts.bins.length;
  const x = (i: number) => (i / Math.max(1, bins - 1)) * W;
  const totals = shifts.bins.map((_, i) => shifts.groups.reduce((sum, g) => sum + g.shares[i], 0) || 1);
  let below = shifts.bins.map(() => 0);
  const bands = shifts.groups.map((g, gi) => {
    const lower = below;
    const upper = lower.map((v, i) => v + g.shares[i] / totals[i]);
    below = upper;
    const top = upper.map((v, i) => `${x(i).toFixed(1)},${(H - v * H).toFixed(1)}`);
    const bottom = lower.map((v, i) => `${x(i).toFixed(1)},${(H - v * H).toFixed(1)}`).reverse();
    return { g, path: `M${top.join("L")}L${bottom.join("L")}Z`, hue: hues[gi] };
  });
  return (
    <div className="shift-share">
      <h4>Share of visits <span className="stream-key">{bands.map(b => <span key={b.g.id}><i style={{ background: `var(${b.hue})` }} />{b.g.headline}</span>)}</span></h4>
      <svg viewBox={`0 0 ${W} ${H}`} className="shift-stream" role="img" preserveAspectRatio="none"
        aria-label={`Share of each visitor group over time: ${shifts.groups.map(g => `${g.headline} ${percent(g.from)} to ${percent(g.to)}`).join(", ")}`}>
        {bands.map(b => <path key={b.g.id} d={b.path} style={{ fill: `var(${b.hue})` }} className={b.g.event ? "changed" : ""} />)}
      </svg>
      <div className="shift-dates"><span>{day(shifts.bins[0].from)}</span><span>{day(shifts.bins[bins - 1].to)}</span></div>
    </div>
  );
}

const two = (v: number | null | undefined) => v == null ? "–" : v.toFixed(2);

function Bars({ rows, mark }: { rows: { label: string; value: number; on?: boolean }[]; mark?: number }) {
  const top = Math.max(...rows.map(r => r.value), mark || 0, 0.01);
  return (
    <div className="method-bars">
      {rows.map(r => <div key={r.label} className={r.on ? "on" : ""}><span>{r.label}</span><i style={{ width: `${(Math.max(0, r.value) / top) * 100}%` }} /><b className="num">{r.value.toFixed(2)}</b></div>)}
    </div>
  );
}

const band = (b: [number, number, number]) => `${b[0] >= 0 ? "+" : "−"}${Math.abs(b[0] * 100).toFixed(1)} pts`;
const range = (b: [number, number, number]) => `${(b[1] * 100).toFixed(1)} to ${(b[2] * 100).toFixed(1)}`;

function Impact({ current, goal }: { current: DeviceShifts; goal: string }) {
  const impact = current.impact!;
  const names = new Map(current.groups.map(g => [g.id, g.headline]));
  const withSources = current.groups.filter(g => g.sources);
  // With two groups, one's change is the other's in reverse: show the one that grew.
  const sourced = withSources.length === 2 && current.groups.length === 2 ? withSources.filter(g => g.sources!.change > 0) : withSources;
  return (
    <div className="method-block">
      <h4>{goal} <span>before and after {day(impact.since)}, split by Kitagawa decomposition; 95% bootstrap intervals</span></h4>
      <dl className="stats">
        <div><dt>Change</dt><dd>{band(impact.total)}<small>{percent(impact.rate_before)} → {percent(impact.rate_after)} · {range(impact.total)}</small></dd></div>
        <div><dt>Who's visiting</dt><dd>{band(impact.mix)}<small>{range(impact.mix)}</small></dd></div>
        <div><dt>How they behave</dt><dd>{band(impact.behaviour)}<small>{range(impact.behaviour)}</small></dd></div>
      </dl>
      <table className="shift-table"><thead><tr><th>Group</th><th>Share before → after</th><th>{goal} before → after</th></tr></thead>
        <tbody>{impact.groups.map(g => <tr key={g.id}><td>{names.get(g.id)}</td><td className="num">{percent(g.share_before)} → {percent(g.share_after)}</td><td className="num">{percent(g.rate_before)} → {percent(g.rate_after)}</td></tr>)}</tbody>
      </table>
      {sourced.map(g => <p key={g.id} className="method-note">{g.headline} {band([g.sources!.change, g.sources!.change, g.sources!.change])}: traffic mix {band(g.sources!.traffic)} ({range(g.sources!.traffic)}), within sources {band(g.sources!.within)} ({range(g.sources!.within)}){g.sources!.drivers.length ? `; mainly ${g.sources!.drivers[0].source}, ${percent(g.sources!.drivers[0].traffic_before)} → ${percent(g.sources!.drivers[0].traffic_after)} of visits` : ""}.</p>)}
    </div>
  );
}

function Method({ current, arrows, setArrows }: { current: DeviceShifts; arrows: boolean; setArrows: (on: boolean) => void }) {
  const map = current.map, m = current.method;
  const measures = Object.keys(map?.loadings || {});
  const leaning = (axis: 0 | 1) => Object.entries(map?.loadings || {}).sort((a, b) => Math.abs(b[1][axis]) - Math.abs(a[1][axis])).slice(0, 3)
    .map(([feature, l]) => `${measureName(feature)} ${l[axis] >= 0 ? "+" : "−"}${Math.abs(l[axis]).toFixed(2)}`).join(" · ");
  return (
    <>
      {m && <div className="method-block">
        <h4>Group checks <span>{current.structure === "clear" ? "clearly separated" : "real, blurry at the edges"}</span></h4>
        <dl className="stats">
          <div><dt>Silhouette</dt><dd>{two(m.silhouette)}<small>no-groups max {two(m.null_silhouette_max)}</small></dd></div>
          <div><dt>Stability</dt><dd>{two(m.stability)}<small>ARI over 80% resamples</small></dd></div>
          <div><dt>Ward agreement</dt><dd>{m.agreement == null ? "–" : percent(m.agreement)}<small>of visits</small></dd></div>
        </dl>
      </div>}
      {map && <div className="method-block">
        <h4>Map <span>PCA of the {measures.length} grouping measures, one scale on both axes</span></h4>
        <dl className="stats">
          <div><dt>Kept by the map</dt><dd>{percent(map.explained)}</dd></div>
          {map.components && <div><dt>Left → right</dt><dd>{percent(map.components[0])}<small>{leaning(0)}</small></dd></div>}
          {map.components && <div><dt>Bottom → top</dt><dd>{percent(map.components[1])}<small>{leaning(1)}</small></dd></div>}
        </dl>
        <label className="method-toggle"><input type="checkbox" checked={arrows} onChange={e => setArrows(e.target.checked)} /> Show measures on the map</label>
      </div>}
      {m && m.k_range.length > 1 && <div className="method-block">
        <h4>Number of groups <span>silhouette by k; fewest within 0.02 of the best{m.goal_informed ? ", goal-aware" : ""}</span></h4>
        <Bars rows={m.k_range.map((k, i) => ({ label: `k = ${k}`, value: m.silhouettes[i] ?? 0, on: k === m.k }))} />
      </div>}
      {m && m.effects.length > 0 && <div className="method-block">
        <h4>What sets groups apart <span>Kruskal-Wallis ε², medium from 0.08</span></h4>
        <Bars rows={[...m.effects].sort((a, b) => b.effect - a.effect).filter(e => e.effect >= 0.02).map(e => ({ label: !measures.length || measures.includes(e.feature) ? measureName(e.feature) : `${measureName(e.feature)}*`, value: e.effect, on: e.effect >= 0.08 }))} />
        {m.effects.some(e => e.effect < 0.02) && <p className="method-note">and {m.effects.filter(e => e.effect < 0.02).length} more under 0.02</p>}
        {measures.length > 0 && m.effects.some(e => e.effect >= 0.02 && !measures.includes(e.feature)) && <p className="method-note">* Not used to group: it follows from the other page-zone shares.</p>}
      </div>}
    </>
  );
}

export default function GroupShiftsView({ shifts }: { shifts: GroupShifts }) {
  const devices = (["desktop", "mobile"] as Device[]).filter(d => shifts[d]);
  const [picked, setPicked] = useState<Device | null>(null);
  const [arrows, setArrows] = useState(false);
  const device = picked && shifts[picked] ? picked : devices[0];
  if (!device) return null;
  const current = shifts[device]!;
  const hues = groupColorSlots(current.groups.map(g => g.key || undefined)).map(slot => HUES[slot]);
  const lines = shiftSentences(current, device, { goal: shifts.goal, changes: shifts.changes });
  return (
    <section className="panel shifts">
      <div className="panel-head"><h2>How the groups changed</h2>
        {devices.length > 1 && <div className="end"><div className="seg" role="group" aria-label="Device">{devices.map(d => <button key={d} type="button" className={d === device ? "on" : ""} onClick={() => setPicked(d)}>{d === "desktop" ? "Desktop" : "Mobile"}</button>)}</div></div>}
      </div>
      <div className="panel-body">
        {current.map?.frames.length === current.bins.length && <GroupMap key={device} shifts={current} map={current.map} hues={hues} device={device} arrows={arrows} changes={shifts.changes} />}
        {lines.length
          ? <ul className="shift-lines">{lines.map(line => <li key={line}>{line}</li>)}</ul>
          : <p className="muted">No real changes: shares and behaviour stayed within normal variation.</p>}
        <details className="shift-details"><summary>Details</summary>
          {current.impact && shifts.goal && <Impact current={current} goal={shifts.goal} />}
          <Method current={current} arrows={arrows} setArrows={setArrows} />
          <Stream shifts={current} hues={hues} />
          <details className="shift-weeks"><summary>Weekly numbers</summary>
            <table className="shift-table"><thead><tr><th>Week of</th>{current.groups.map(g => <th key={g.id}>{g.headline}</th>)}<th>Visits</th></tr></thead>
              <tbody>{current.bins.map((b, i) => <tr key={b.from}><td>{day(b.from)}</td>{current.groups.map(g => <td key={g.id} className="num">{percent(g.shares[i])}</td>)}<td className="num">{b.visits}</td></tr>)}</tbody>
            </table>
          </details>
          <p className="method-note">Changes: {current.bin_weeks === 1 ? "weekly" : `${current.bin_weeks}-week`} shares with 95% Wilson intervals · share changes by two-proportion test at the best split, Bonferroni over splits · behaviour by Mann-Whitney U · Benjamini-Hochberg 10% across groups and measures.</p>
        </details>
      </div>
    </section>
  );
}
