import assert from "node:assert/strict";
import test from "node:test";
import { alikeNote, analysisAdvice, deviceGoal, inactiveVisits, traitRows, visitCount, visitorIntro, visitorTypes } from "../src/analysis.ts";
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
  assert.equal(alikeNote(result, "desktop"), "Visitors behave alike.");
  assert.match(visitorIntro(result, "desktop", 2), /The rest behave much alike/);
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
