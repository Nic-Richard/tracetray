import { test } from "node:test";
import assert from "node:assert/strict";
import { changeDayError, comparisonGoalSummary, comparisonGroupScope, comparisonPeriods, comparisonStatus, comparisonRate, comparisonVerdict, COMPARISON_ROWS } from "../src/compare.ts";

test("change dates reject impossible dates and future days without changing the UTC boundary", () => {
  for (const day of ["", "2026-2-01", "2026-02-30", "2025-02-29", "2026-13-01", "bad-date"]) assert.ok(changeDayError(day, "2026-10-18"));
  for (const day of ["2024-02-29", "2026-10-18", "2026-01-01"]) assert.equal(changeDayError(day, "2026-10-18"), null);
  assert.match(changeDayError("2026-10-19", "2026-10-18"), /future/);
});

test("before and after describes observed direction and uncertainty without attributing cause", () => {
  const goal = { name: "Checkout", before: 0.1, after: 0.2, verdict: "better" };
  assert.match(comparisonGoalSummary(goal), /rose, from 10% to 20%/);
  assert.match(comparisonGoalSummary(goal), /doesn't establish that the page change caused/);
  assert.match(comparisonGoalSummary({ ...goal, before: 0.3, verdict: "worse" }), /fell/);
  assert.match(comparisonGoalSummary({ ...goal, verdict: "same" }), /don't establish a clear difference/);
  assert.match(comparisonGoalSummary({ ...goal, verdict: "unclear" }), /Too few visits or goal completions/);
  assert.doesNotMatch(comparisonGoalSummary(goal), /A win|more than chance/);
  assert.equal(comparisonPeriods("2026-10-01", 3), "Before: 2026-09-28 to 2026-09-30; after: 2026-10-02 to 2026-10-04 (UTC). Both devices; completed visits only, unfinished visits excluded. The change day (2026-10-01) is excluded.");
  assert.match(comparisonGroupScope({ visits: 120, from: "2026-08-01T00:00:00Z", to: "2026-10-01T00:00:00Z", ran_at: "2026-10-02T00:00:00Z" }), /120 desktop visits.+2026-08-01 to 2026-10-01/);
  assert.match(comparisonGroupScope(null), /no scope details/);
});

test("follow-up scope, uncertainty and unavailable goals stay explicit", () => {
  assert.match(comparisonPeriods("2026-12-31", 2, "mobile"), /after: 2027-01-01 to 2027-01-02.+Mobile only/);
  assert.match(comparisonPeriods("2026-10-01", 2, "desktop"), /Desktop only/);
  const summary = comparisonGoalSummary({ name: "Buy", before: 0.1, after: 0.2, verdict: "unclear", provisional: true, difference_ci: [-0.02, 0.22] });
  assert.match(summary, /Provisional/);
  assert.match(summary, /95% interval -2.0 to 22.0/);
  assert.match(summary, /assumes independent visits/);
  assert.doesNotMatch(summary, /exceeds.+threshold/);
  assert.match(comparisonStatus({ goal_status: "changed" }), /new baseline/);
  assert.match(comparisonStatus({ goal_status: "backfilling" }), /paused/);
  assert.match(comparisonStatus({ goal_status: "none" }), /No goal was recorded/);
  assert.match(comparisonStatus({ goal_status: "legacy" }), /current main goal/);
  assert.equal(comparisonStatus({ goal_status: "ready" }), "");
});

test("only engagement receives directional labels; zero baselines and small changes stay neutral", () => {
  const engaged = COMPARISON_ROWS.find(row => row.key === "engaged");
  assert.equal(comparisonVerdict(engaged, 0.5, 0.7), "better");
  assert.equal(comparisonVerdict(engaged, 0.5, 0.3), "worse");
  assert.equal(comparisonVerdict(engaged, 0.5, 0.51), "same");
  assert.equal(comparisonVerdict(engaged, 0, 0.7), null);
  for (const row of COMPARISON_ROWS.filter(row => row.key !== "engaged")) assert.equal(comparisonVerdict(row, 0.2, 0.6), null);
  assert.equal(comparisonRate(null), "–");
  assert.equal(comparisonRate(0), "0.0%");
  assert.equal(comparisonRate(0.025), "2.5%");
});
