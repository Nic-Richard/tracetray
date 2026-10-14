const PATHS: Record<string, string> = {
  pages: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  ask: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z",
  journeys: "M13 17l5-5-5-5M6 17l5-5-5-5",
  sessions: "M7 3h10a2 2 0 012 2v14a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2zM9 8h6M9 12h6M9 16h4",
  setup: "M16 18l6-6-6-6M8 6l-6 6 6 6",
  search: "M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-4.3-4.3",
  moon: "M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z",
  sun: "M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  bug: "M8 2l1.9 1.9M16 2l-1.9 1.9M9 7.1V6a3 3 0 016 0v1.1M12 20a6 6 0 01-6-6v-3a4 4 0 014-4h4a4 4 0 014 4v3a6 6 0 01-6 6zM12 20v-9M6 13H2M22 13h-4M3 21l3-3M21 21l-3-3M3 7l3 3M21 7l-3 3",
  chevron: "M6 9l6 6 6-6",
  close: "M18 6L6 18M6 6l12 12"
};

export default function Icon({ name, size = 18 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
