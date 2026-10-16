import { percent, type Trait } from "@tracetray/shared";

const perMinute = (v: number) => (v * 60).toFixed(1);
const seconds = (v: number) => `${(v / 1000).toFixed(1)} s`;

const MEASURES: Record<string, { label: string; format: (v: number) => string }> = {
  pause_rate: { label: "Pauses a minute", format: perMinute },
  click_rate: { label: "Clicks a minute", format: perMinute },
  tap_rate: { label: "Taps a minute", format: perMinute },
  move_density: { label: "Cursor moves a second", format: v => v.toFixed(1) },
  avg_cursor_velocity: { label: "Cursor speed", format: v => `${v.toFixed(1)} px/ms` },
  dwell_before_click: { label: "Wait before clicking", format: seconds },
  dwell_before_tap: { label: "Wait before tapping", format: seconds },
  spatial_entropy: { label: "Cursor spread", format: v => percent(v / Math.log2(9)) },
  top_zone_ratio: { label: "Cursor time in the top third", format: v => percent(v) },
  centre_zone_ratio: { label: "Cursor time in the middle third", format: v => percent(v) },
  bottom_zone_ratio: { label: "Cursor time in the bottom third", format: v => percent(v) },
  scroll_depth_reached: { label: "How far down", format: v => percent(v) },
  direction_change_rate: { label: "Scrolls back up a minute", format: perMinute },
  scroll_velocity_rate: { label: "Scroll speed", format: v => `${v.toFixed(2)} px/ms` },
  attention_pause_rate: { label: "Reading stops a minute", format: perMinute },
  avg_attention_pause_ms: { label: "Typical reading stop", format: seconds }
};

export default function TraitBars({ traits, color }: { traits: Trait[]; color: string }) {
  const rows = traits.filter(t => MEASURES[t.feature] && typeof t.value === "number" && typeof t.page_average === "number");
  if (rows.length === 0) return null;
  return (
    <div className="trait-bars">
      {rows.map(t => {
        const measure = MEASURES[t.feature];
        const top = Math.max(t.value, t.page_average) * 1.15 || 1;
        return (
          <div key={t.feature} className="trait-bar" title={`They ${t.description}.`}>
            <div className="trait-bar-label"><span>{measure.label}</span><span><b>{measure.format(t.value)}</b> vs {measure.format(t.page_average)}</span></div>
            <div className="trait-bar-track"><i style={{ width: `${(t.value / top) * 100}%`, background: color }} /><span style={{ left: `${(t.page_average / top) * 100}%` }} /></div>
          </div>
        );
      })}
    </div>
  );
}
