import assert from "node:assert/strict";
import test from "node:test";
import { alikeNote, analysisAdvice, analysisPeriod, analysisScope, findingScope, deviceGoal, goalDrivers, groupCountNote, inactiveVisits, traitRows, visitCount, visitorIntro, visitorTypes } from "../src/analysis.ts";
import { groupColorSlots } from "../src/palette.ts";

function fixture() {
  return {
    session_count: 80, inactive_count: 20, structure: "clear",
    clusters: [
      { id: 0, label: "Smaller group", n: 20, feature_means: {}, goal_hits: { buy: 2 } },
      { id: 1, label: "Larger group", n: 60, feature_means: {}, goal_hits: { buy: 30 } }
    ],
    goal: { id: "buy", name: "Buy" }, inactive_goal_hits: { buy: 1 },
    interpretation: { cluster_stories: { 1: { headline: "Deciders", key: "quick_deciders", goal: { rate: 0.5, average: 0.33 } } } }
  };
}

test("recorded finding scope survives independently of later analyses and includes merged evidence", () => {
  const scope = { from: "2026-09-01", to: "2026-10-01", window_days: 90, limit: 20000, at_limit: false, excluded_detail: 5, excluded_events: 3 };
  const finding = { device: "mobile", session_count: 200, inactive_count: 10, scope,
    related_scopes: [{ device: "desktop", session_count: 300, inactive_count: 15, scope }] };
  assert.match(findingScope(finding), /200 mobile visits/);
  assert.match(findingScope(finding), /300 desktop visits/);
  assert.match(findingScope(finding), /5 visits without full detail and 3/);
  assert.match(findingScope(finding), /10 visits without recorded interaction/);
});

test("shares and goal averages include visits that never interacted", () => {
  const result = fixture();
  assert.equal(visitCount(result, "desktop"), 100);
  assert.deepEqual(visitorTypes(result, "desktop").map(row => [row.headline, row.share]), [["Deciders", 0.6], ["Smaller group", 0.2]]);
  assert.deepEqual(deviceGoal(result, "desktop"), { name: "Buy", rate: 0.33 });
  assert.deepEqual(inactiveVisits(result, "desktop"), { count: 20, share: 0.2, goal: { name: "Buy", rate: 0.05 } });
});

test("older analysis names still work and missing phone analysis stays empty", () => {
  const result = fixture();
  result.ai_interpretation = result.interpretation;
  delete result.interpretation;
  assert.equal(visitorTypes(result, "desktop")[0].headline, "Deciders");
  assert.equal(visitCount(result, "mobile"), 0);
  assert.deepEqual(visitorTypes(result, "mobile"), []);
  assert.equal(deviceGoal(result, "mobile"), null);
  assert.equal(inactiveVisits(result, "mobile"), null);
});

test("unreliable groups get the alike explanation and no stale suggestions", () => {
  const result = fixture();
  result.structure = "none";
  result.interpretation.alike = { desktop: "Visitors behave alike." };
  result.interpretation.advice = [{ action: "Move the button", evidence: "Measured clicks", device: "desktop", group: "Deciders" }];
  assert.match(alikeNote(result, "desktop"), /^No reliable groups found/);
  assert.match(visitorIntro(result, "desktop", 2), /No reliable groups found/);
  assert.deepEqual(analysisAdvice(result), []);
  result.structure = "some";
  result.session_count = 160;
  assert.match(visitorIntro(result, "desktop", 2), /groups overlap/);
  assert.equal(analysisAdvice(result).length, 1);
  result.interpretation.advice[0].evidence = "";
  assert.deepEqual(analysisAdvice(result), []);
});

test("groups from fewer than 100 analysed visits are early signs with no suggestions", () => {
  const result = fixture();
  result.interpretation.advice = [{ action: "Move the button", evidence: "Measured clicks", device: "desktop", group: "Deciders" }];
  assert.match(visitorIntro(result, "desktop", 2), /too few visits to suggest changes/);
  assert.deepEqual(analysisAdvice(result), []);
  result.session_count = 100;
  assert.doesNotMatch(visitorIntro(result, "desktop", 2), /too few/);
  assert.equal(analysisAdvice(result).length, 1);
});

test("phone groups use their own stories, counts and inactive visitors", () => {
  const result = fixture();
  result.mobile = { session_count: 10, inactive_count: 5, clusters: [{ id: 0, label: "Readers", n: 10, feature_means: {} }] };
  result.interpretation.mobile_cluster_stories = { 0: { headline: "Phone readers" } };
  assert.equal(visitCount(result, "mobile"), 15);
  assert.equal(visitorTypes(result, "mobile")[0].headline, "Phone readers");
  assert.equal(visitorTypes(result, "mobile")[0].share, 2 / 3);
  assert.equal(inactiveVisits(result, "mobile").goal, null);
});

test("trait units and marker positions compare against the same scale", () => {
  const traits = traitRows([
    { feature: "click_rate", value: 0.1, page_average: 0.05, description: "click more" },
    { feature: "dwell_before_tap", value: 1500, page_average: 3000, description: "tap sooner" },
    { feature: "spatial_entropy", value: Math.log2(9), page_average: 0, description: "cover the page" },
    { feature: "pause_rate", value: 0, page_average: 0, description: "never pause" }
  ]);
  assert.equal(traits[0].value, "6.0");
  assert.equal(traits[0].average, "3.0");
  assert.ok(Math.abs(traits[0].valuePosition - 1 / 1.15) < 1e-12);
  assert.equal(traits[0].averagePosition, traits[0].valuePosition / 2);
  assert.equal(traits[1].value, "1.5 s");
  assert.equal(traits[2].value, "100%");
  assert.equal(traits[3].valuePosition, 0);
  for (const value of [NaN, Infinity, -1]) assert.deepEqual(traitRows([{ feature: "click_rate", value, page_average: 0 }]), []);
  assert.deepEqual(traitRows([{ feature: "unknown", value: 1, page_average: 1 }]), []);
});

test("group colours stay stable and conflicting preferences get separate slots", () => {
  assert.deepEqual(groupColorSlots(["deep_readers", "skimmers", "typical"]), [0, 1, 6]);
  const slots = groupColorSlots(["deep_readers", "methodical", "m_readers", "unknown", undefined]);
  assert.equal(new Set(slots).size, slots.length);
  assert.deepEqual(groupColorSlots(["quick_deciders"]), [1]);
  assert.deepEqual(groupColorSlots(["constructor", "__proto__"]), [0, 1]);
});

test("a group's age reads New, Since a date, or nothing on its first tracked analysis", () => {
  const result = fixture();
  result.ran_at = "2026-10-26T06:00:00Z";
  result.clusters[0].track = { id: "a", since: "2026-10-26T06:00:00Z", new: true };
  result.clusters[1].track = { id: "b", since: "2026-10-05T06:00:00Z" };
  assert.deepEqual(visitorTypes(result, "desktop").map(row => row.age), ["Since Oct 5", "New"]);
  result.clusters[0].track = { id: "a", since: "2026-10-26T06:00:00Z" };
  assert.equal(visitorTypes(result, "desktop")[1].age, null);
});

test("the goal model reads as plain sentences only when it held up", () => {
  const result = fixture();
  result.goal = { id: "buy", name: "Added to cart" };
  result.goal_model = { status: "ok", reached: 400, missed: 400, window_s: 20, drivers: [
    { feature: "avg_cursor_velocity", direction: "higher", split: 0.4, rate_above: 0.76, rate_below: 0.21 },
    { feature: "scroll_burst_rate", direction: "lower", split: 0, rate_above: 0.1, rate_below: 0.4 }
  ] };
  const drivers = goalDrivers(result, "desktop");
  assert.match(drivers.intro, /800 desktop visits \(400 reached the goal, 400 didn't\)/);
  assert.match(drivers.intro, /count of excluded conversion visits wasn't saved/);
  assert.deepEqual(drivers.lines, [
    "Those that moved the cursor faster than most by then went on to reach Added to cart 76% of the time, against 21% for the others.",
    "Those that hadn't started scrolling by then went on to reach Added to cart 40% of the time, against 10% for the others."
  ]);
  result.goal_model.too_quick = 12;
  assert.match(goalDrivers(result, "desktop").intro, /12 conversion visits left out/);
  result.goal_model.window_s = null;
  assert.match(goalDrivers(result, "desktop").intro, /aren't pre-goal predictors/);
  result.goal_model.status = "weak";
  assert.equal(goalDrivers(result, "desktop"), null);
});

test("scope keeps device periods and exclusions separate without inventing legacy dates", () => {
  const result = fixture();
  assert.match(analysisPeriod(result, "desktop"), /weren't saved/);
  result.scope = { from: "2026-08-01T01:00:00Z", to: "2026-10-27T00:00:00Z", window_days: 90, limit: 20000, at_limit: true, excluded_detail: 12, excluded_events: 3 };
  result.mobile = { session_count: 25, inactive_count: 5, clusters: [], scope: { ...result.scope, from: "2026-10-01T00:00:00Z", at_limit: false } };
  assert.match(analysisScope(result, "desktop"), /80 desktop visits/);
  assert.match(analysisScope(result, "desktop"), /Aug 1, 2026 to Oct 27, 2026 \(UTC\)/);
  assert.match(analysisScope(result, "desktop"), /12 visits without full detail and 3 without recorded events excluded/);
  assert.match(analysisScope(result, "desktop"), /earlier visits are excluded/);
  assert.match(analysisScope(result, "mobile"), /25 mobile visits/);
  assert.match(analysisScope(result, "mobile"), /Oct 1, 2026/);
  assert.match(analysisScope(result, "mobile"), /90-day analysis window/);
  result.k_rationale = { goal_informed: true };
  assert.match(groupCountNote(result, "desktop"), /Goal outcomes helped choose/);
  result.k_rationale.goal_informed = false;
  assert.equal(groupCountNote(result, "desktop"), null);
  delete result.k_rationale.goal_informed;
  assert.match(groupCountNote(result, "desktop"), /doesn't record whether/);
});
