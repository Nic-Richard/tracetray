const assert = require("node:assert/strict");
const { test } = require("node:test");
const { monthOf, monthRange } = require("../src/lib/usage");
const { planLimits } = require("../src/lib/plans");
const { lockUnits } = require("../src/lib/limits");

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

test("pages are allowed in order by address count, and a group that doesn't fit is locked while smaller pages still fit", () => {
    const units = [
        { key: "home", addresses: 1 }, { key: "collections", addresses: 5 }, { key: "posts", addresses: 5 },
        { key: "products", addresses: 24 }, { key: "cart", addresses: 1 }, { key: "checkout", addresses: 1 }
    ];
    assert.deepEqual([...lockUnits(units, 30)], ["products"]);
    assert.deepEqual([...lockUnits(units, 37)], []);
    assert.deepEqual([...lockUnits(units, 36)], ["checkout"]);
    assert.deepEqual([...lockUnits(units, 5)], ["collections", "posts", "products"]);
});
