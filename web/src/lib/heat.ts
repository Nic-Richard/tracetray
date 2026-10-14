const STOPS: [number, [number, number, number]][] = [
  [0, [0x4c, 0x4c, 0xdb]],
  [0.55, [0xb0, 0x3f, 0xb0]],
  [1, [0xf0, 0x8a, 0x24]]
];

// Square root, so smaller pages still get different colours next to one huge page.
export function heatColor(value: number, max: number): string {
  const t = max > 0 && value > 0 ? Math.min(1, Math.sqrt(value / max)) : 0;
  const upper = STOPS.findIndex(([stop]) => stop >= t);
  const [s1, c1] = STOPS[Math.max(0, upper - 1)];
  const [s2, c2] = STOPS[Math.max(0, upper)];
  const k = s2 === s1 ? 0 : (t - s1) / (s2 - s1);
  const [r, g, b] = c1.map((c, i) => Math.round(c + (c2[i] - c) * k));
  return `rgb(${r}, ${g}, ${b})`;
}
