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

test("Stripe prices map to plans by lookup key, and old prices still map by their ID", () => {
    const { planForPrice } = require("../src/lib/plans");
    assert.equal(planForPrice({ lookup_key: "tracetray_pro_yearly" }), "pro");
    assert.equal(planForPrice({ lookup_key: "tracetray_starter_monthly" }), "starter");
    assert.equal(planForPrice({ lookup_key: "tracetray_ultra_yearly" }), "ultra");
    process.env.STRIPE_PRO_PRICE_ID = "price_old_pro";
    assert.equal(planForPrice({ id: "price_old_pro", lookup_key: null }), "pro");
    assert.equal(planForPrice({ id: "price_old_starter", lookup_key: null }), "starter");
});

test("busy pages keep full detail for a sample of visits, the same one for every batch", () => {
    const { rateFor, inSample } = require("../src/lib/sampling");
    assert.equal(rateFor(400, 20000), 1);
    assert.equal(rateFor(4000, 20000), 0.25);
    assert.equal(rateFor(500, 400000), 0.25);
    const ids = Array.from({ length: 4000 }, (_, i) => `visit-${i}`);
    const kept = ids.filter(id => inSample(id, 0.25)).length;
    assert.ok(kept > 850 && kept < 1150, `kept ${kept} of 4000`);
    assert.ok(ids.every(id => inSample(id, 0.25) === inSample(id, 0.25)));
    assert.ok(ids.every(id => inSample(id, 1)));
});

test("the weekly summary comes with every plan, shift alerts and exports from Pro up", () => {
    const { wantsEmail, emailAvailable } = require("../src/lib/emailPrefs");
    const { hasFeature } = require("../src/lib/limits");
    assert.equal(wantsEmail({ plan: "starter" }, "weekly_summary", "production"), true);
    assert.equal(emailAvailable({ plan: "starter" }, "shift_alerts", "production"), false);
    assert.equal(emailAvailable({ plan: "ultra" }, "shift_alerts", "production"), true);
    assert.equal(emailAvailable({ plan: "none" }, "weekly_summary", "production"), false);
    assert.equal(hasFeature({ plan: "starter" }, "csvExport", "production"), false);
    assert.equal(hasFeature({ plan: "pro" }, "csvExport", "production"), true);
    assert.equal(hasFeature({ plan: "starter" }, "csvExport", "beta"), true);
});
