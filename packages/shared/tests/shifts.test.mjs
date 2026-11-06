import test from "node:test";
import assert from "node:assert/strict";
import { mapDirections, shiftSentences } from "../src/shifts.ts";

const bins = [0, 1, 2, 3].map(i => ({ from: Date.UTC(2026, 7, 17 + 7 * i), to: Date.UTC(2026, 7, 24 + 7 * i), visits: 200 }));
const group = (headline, extra) => ({ id: 0, key: null, headline, shares: [], low: [], high: [], event: null, from: 0.2, to: 0.2, drift: [], ...extra });

test("shift sentences name what changed and stay quiet otherwise", () => {
  assert.deepEqual(shiftSentences({ structure: "some", bin_weeks: 1, bins, groups: [group("Re-checkers")] }, "desktop"), []);
  const lines = shiftSentences({ structure: "some", bin_weeks: 1, bins, groups: [
    group("Re-checkers", { event: "shrank", since: Date.UTC(2026, 8, 14), from: 0.31, to: 0.18, drift: [{ feature: "dwell_before_click", before: 2.4, after: 1.5, change: -0.38 }] }),
    group("Quick leavers", { event: "appeared", since: Date.UTC(2026, 8, 7), from: 0, to: 0.12 })
  ] }, "desktop");
  assert.deepEqual(lines, [
    "Re-checkers: 31% → 18% of desktop visits since Sep 14.",
    "New: Quick leavers, 12% of desktop visits since Sep 7.",
    "Re-checkers now wait before clicking about a third less than they did around Aug 17."
  ]);
});

test("a share that changed more than once reads as steps, and drift is timed from the change", () => {
  const steps = [{ since: bins[0].from, share: 0.25 }, { since: bins[1].from, share: 0.45 }, { since: bins[3].from, share: 0.26 }];
  assert.deepEqual(shiftSentences({ structure: "some", bin_weeks: 1, bins, groups: [
    group("Header scanners", { event: "grew", since: bins[1].from, from: 0.25, to: 0.38, steps,
      drift: [{ feature: "click_rate", before: 0.1, after: 0.05, change: -0.5, since: bins[1].from }] })
  ] }, "desktop"), [
    "Header scanners: 25% → 45% of desktop visits around Aug 24, then back to 26% around Sep 7.",
    "Header scanners now click about a half less than they did before Aug 24."
  ]);
});

test("map directions are named only after measures that move strongly with them", () => {
  const map = { explained: 0.6, frames: [], loadings: { click_rate: [0.8, 0.1], dwell_before_click: [-0.7, 0.2], direction_change_rate: [0.1, 0.65], pause_rate: [0.2, -0.3] } };
  assert.deepEqual(mapDirections(map), { right: "more clicking", left: "more waiting before clicking", up: "more scrolling back up", down: null });
});

test("the goal's change is explained by who's visiting or how they behave, only where it holds up", () => {
  const since = Date.UTC(2026, 9, 8);
  const changes = [{ day: "2026-10-16", note: "Clearer size guide" }];
  const shifts = (impact, groups = []) => ({ structure: "some", bin_weeks: 1, bins, groups, impact: { since, rate_before: 0.24, rate_after: 0.21, groups: [], ...impact } });
  const mixGroups = { groups: [{ id: 0, share_before: 0.3, share_after: 0.45, rate_before: 0.1, rate_after: 0.1 }, { id: 1, share_before: 0.7, share_after: 0.55, rate_before: 0.3, rate_after: 0.29 }] };
  const leavers = [group("Quick leavers", { id: 0 }), group("Readers", { id: 1 })];
  assert.deepEqual(shiftSentences(shifts({ total: [-0.03, -0.05, -0.01], mix: [-0.028, -0.04, -0.015], behaviour: [-0.002, -0.02, 0.015], ...mixGroups }, leavers), "desktop", { goal: "Added to cart", changes: [{ day: "2026-10-12", note: "Clearer size guide" }] }), [
    "Added to cart: 24% → 21% of desktop visits since Oct 8, close to your change “Clearer size guide” on Oct 12. Driven by who's visiting: more Quick leavers, who reach it less often."
  ]);
  assert.deepEqual(shiftSentences(shifts({ total: [0.04, -0.01, 0.09], mix: [0.012, 0.003, 0.024], behaviour: [0.03, -0.03, 0.08], ...mixGroups }, leavers), "desktop", { goal: "Added to cart", changes }), [
    "Added to cart: 24% → 21% of desktop visits since Oct 8, not conclusive yet. What holds up: more Quick leavers, who reach it less often, worth about 1.2 points."
  ]);
  assert.match(shiftSentences(shifts({ total: [0.001, -0.02, 0.02], mix: [-0.03, -0.045, -0.015], behaviour: [0.031, 0.012, 0.05] }), "desktop", { goal: "Added to cart" })[0],
    /held at about 21% since Oct 8: who's visiting pushed it down, how they behave pushed it back/);
  const grew = group("Header scanners", { event: "grew", since, from: 0.29, to: 0.39, sources: { change: 0.1, traffic: [0.07, 0.03, 0.11], within: [0.03, -0.01, 0.07], drivers: [{ source: "Instagram", part: 0.7, traffic_before: 0.06, traffic_after: 0.18 }] } });
  assert.deepEqual(shiftSentences({ structure: "some", bin_weeks: 1, bins, groups: [grew] }, "desktop"), [
    "Header scanners: 29% → 39% of desktop visits since Oct 8, mostly down to more visits from Instagram."
  ]);
});
