import test from "node:test";
import assert from "node:assert/strict";
import { shiftSentences } from "../src/shifts.ts";

const bins = [0, 1, 2, 3].map(i => ({ from: Date.UTC(2026, 7, 17 + 7 * i), to: Date.UTC(2026, 7, 24 + 7 * i), visits: 200 }));
const group = (headline, extra) => ({ id: 0, key: null, headline, shares: [], low: [], high: [], event: null, from: 0.2, to: 0.2, drift: [], ...extra });

test("shift sentences name what changed and stay quiet otherwise", () => {
  assert.deepEqual(shiftSentences({ structure: "some", bin_weeks: 1, bins, groups: [group("Re-checkers")] }, "desktop"), []);
  const lines = shiftSentences({ structure: "some", bin_weeks: 1, bins, groups: [
    group("Re-checkers", { event: "shrank", since: Date.UTC(2026, 8, 14), from: 0.31, to: 0.18, drift: [{ feature: "dwell_before_click", before: 2.4, after: 1.5, change: -0.38 }] }),
    group("Quick leavers", { event: "appeared", since: Date.UTC(2026, 8, 7), from: 0, to: 0.12 })
  ] }, "desktop");
  assert.deepEqual(lines, [
    "Re-checkers have averaged 18% of desktop visits since around Sep 14, down from 31% before.",
    "New: Quick leavers, first seen around Sep 7, now 12% of desktop visits.",
    "Re-checkers now wait before clicking about a third less than they did around Aug 17."
  ]);
});
