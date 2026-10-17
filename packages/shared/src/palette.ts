const PREFERRED: Record<string, number> = {
  deep_readers: 0, skimmers: 1, explorers: 2, hesitant: 3, deliberate: 4, header_scanners: 5,
  passive: 5, bottom_readers: 4, quick_deciders: 1, rechecking: 3,
  window_shoppers: 2, searchers: 4, methodical: 0, speed_scrollers: 1, comparers: 3,
  m_readers: 0, m_skimmers: 1, m_tappers: 2, m_quick_exits: 3, m_hesitant: 4, m_rechecking: 5, m_deep: 5,
  m_window_shoppers: 2, m_speed: 1, m_lingering: 0, m_first_screen: 3
};

export function groupColorSlots(keys: (string | undefined)[]): number[] {
  const used = new Set<number>();
  return keys.map(key => {
    if (key === "typical") return 6;
    let hue = key && Object.hasOwn(PREFERRED, key) ? PREFERRED[key] : undefined;
    if (hue === undefined || used.has(hue)) hue = [0, 1, 2, 3, 4, 5].find(value => !used.has(value)) ?? used.size % 6;
    used.add(hue);
    return hue;
  });
}
