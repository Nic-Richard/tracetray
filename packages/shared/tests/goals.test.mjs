import test from "node:test";
import assert from "node:assert/strict";
import { describeGoal, formLabel, goalAppliesToPage, parseGoalTarget } from "../src/goals.ts";

test("goal targets convert percentages, accept decimal commas and distinguish blank from invalid zero", () => {
  assert.deepEqual(parseGoalTarget(""), { target: null });
  assert.equal(parseGoalTarget(" 2,5 ").target, 0.025);
  assert.equal(parseGoalTarget("100").target, 1);
  assert.equal(parseGoalTarget(".01").target, 0.0001);
  for (const value of ["0", "-5", "100.1", "NaN", "Infinity", "1e2", "0x10", "2,3,4"]) assert.ok(parseGoalTarget(value).error, value);
});

test("goal descriptions follow match precedence and tolerate old page values", () => {
  assert.equal(describeGoal({ type: "click", match: { id: "buy", href: "/buy", text: "Buy" } }), "Clicks #buy");
  assert.equal(describeGoal({ type: "form", match: { name: "newsletter" } }), "Sends the form “newsletter”");
  assert.equal(formLabel({ id: "signup", name: "fallback", action: null }), "Form #signup");
  assert.equal(describeGoal({ type: "page", match: { page: "bad old value" } }), "Goes on to bad old value");
  assert.equal(describeGoal({ type: "page", match: { page: "https://example.com/thanks" } }), "Goes on to /thanks");
});

test("main goals apply to their scope and exclude their own destination page", () => {
  const goal = { type: "page", match: { page: "https://example.com/thanks" }, pages: ["https://example.com/cart"] };
  assert.equal(goalAppliesToPage(goal, "https://example.com/cart"), true);
  assert.equal(goalAppliesToPage(goal, "https://example.com/other"), false);
  assert.equal(goalAppliesToPage({ ...goal, pages: [] }, goal.match.page), false);
  assert.equal(goalAppliesToPage({ type: "click", match: { text: "Buy" }, pages: [] }, "https://example.com/"), true);
});
