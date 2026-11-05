import { useState } from "react";
import { groupColorSlots, percent, shiftSentences, type Device, type DeviceShifts, type GroupShifts } from "@tracetray/shared";
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
      <h3>Share of visits over time</h3>
      <svg viewBox={`0 0 ${W} ${H}`} className="shift-stream" role="img" preserveAspectRatio="none"
        aria-label={`Share of each visitor group over time: ${shifts.groups.map(g => `${g.headline} ${percent(g.from)} to ${percent(g.to)}`).join(", ")}`}>
        {bands.map(b => <path key={b.g.id} d={b.path} style={{ fill: `var(${b.hue})` }} className={b.g.event ? "changed" : ""} />)}
      </svg>
      <div className="shift-dates"><span>{day(shifts.bins[0].from)}</span><span>{day(shifts.bins[bins - 1].to)}</span></div>
    </div>
  );
}

export default function GroupShiftsView({ shifts }: { shifts: GroupShifts }) {
  const devices = (["desktop", "mobile"] as Device[]).filter(d => shifts[d]);
  const [picked, setPicked] = useState<Device | null>(null);
  const device = picked && shifts[picked] ? picked : devices[0];
  if (!device) return null;
  const current = shifts[device]!;
  const hues = groupColorSlots(current.groups.map(g => g.key || undefined)).map(slot => HUES[slot]);
  const lines = shiftSentences(current, device);
  const latest = current.bins.length - 1;
  return (
    <section className="panel shifts">
      <div className="panel-head"><h2>How the groups changed</h2>
        {devices.length > 1 && <div className="end"><div className="seg" role="group" aria-label="Device">{devices.map(d => <button key={d} type="button" className={d === device ? "on" : ""} onClick={() => setPicked(d)}>{d === "desktop" ? "Desktop" : "Mobile"}</button>)}</div></div>}
      </div>
      <div className="panel-body">
        {current.map?.frames.length === current.bins.length && <GroupMap key={device} shifts={current} map={current.map} hues={hues} device={device} />}
        <ul className="shift-legend">{current.groups.map((g, i) => <li key={g.id}><i style={{ background: `var(${hues[i]})` }} />{g.headline}<b className="num">{percent(g.shares[latest])}</b></li>)}</ul>
        {lines.length
          ? <ul className="shift-lines">{lines.map(line => <li key={line}>{line}</li>)}</ul>
          : <p>No real shifts: each group's share stayed within normal week-to-week variation, and no group's behaviour changed beyond chance.</p>}
        <Stream shifts={current} hues={hues} />
        <p className="muted">From the latest analysis: every visit belongs to a group defined the same way, counted in {current.bin_weeks === 1 ? "weekly" : `${current.bin_weeks}-week`} steps. A change is only described when it holds up after allowing for the number of groups and measures checked.</p>
        <details className="shift-table"><summary>Show as a table</summary>
          <table><thead><tr><th>From</th>{current.groups.map(g => <th key={g.id}>{g.headline}</th>)}<th>Visits</th></tr></thead>
            <tbody>{current.bins.map((b, i) => <tr key={b.from}><td>{day(b.from)}</td>{current.groups.map(g => <td key={g.id} className="num">{percent(g.shares[i])}</td>)}<td className="num">{b.visits}</td></tr>)}</tbody>
          </table>
        </details>
      </div>
    </section>
  );
}
