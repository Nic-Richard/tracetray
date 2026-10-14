const assert = require("node:assert/strict");
const { test } = require("node:test");
const { monthOf, monthRange } = require("../src/lib/usage");
const { planLimits } = require("../src/lib/plans");

test("months run from the first of the month to the first of the next, across the year end", () => {
    assert.equal(monthOf(new Date("2026-10-14T23:59:00Z")), "2026-10");
    assert.deepEqual(monthRange("2026-10"), { from: "2026-10-01", to: "2026-11-01" });
    assert.deepEqual(monthRange("2026-12"), { from: "2026-12-01", to: "2027-01-01" });
});

test("each plan has limits and no plan has none", () => {
    assert.equal(planLimits("starter").pages, 50);
    assert.equal(planLimits("pro").visits, 100000);
    assert.equal(planLimits("enterprise").pages, null);
    assert.equal(planLimits("none"), null);
});
