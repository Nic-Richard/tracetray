import { traitRows, type Trait } from "@tracetray/shared";

export default function TraitBars({ traits, color }: { traits: Trait[]; color: string }) {
  const rows = traitRows(traits);
  if (rows.length === 0) return null;
  return (
    <div className="trait-bars">
      {rows.map(row => (
        <div key={row.feature} className="trait-bar" title={`They ${row.description}.`}>
          <div className="trait-bar-label"><span>{row.label}</span><span><b>{row.value}</b> vs {row.average}</span></div>
          <div className="trait-bar-track"><i style={{ width: `${row.valuePosition * 100}%`, background: color }} /><span className="average" style={{ left: `${row.averagePosition * 100}%` }} /><span style={{ left: `${row.valuePosition * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}
