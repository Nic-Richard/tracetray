const assert = require("node:assert/strict");
const { test } = require("node:test");
const { visitTime, cleanSummary, cleanReferrer } = require("../src/lib/tracking");
const { groupPage } = require("../src/lib/pageGroups");

test("what a browser sends is checked before it's stored", () => {
    const now = Date.UTC(2026, 9, 15, 12);
    assert.equal(visitTime(now - 60000, now), now - 60000);
    assert.equal(visitTime(now + 400 * 864e5, now), now);
    assert.equal(visitTime("yesterday", now), now);
    assert.equal(visitTime({ $gt: 0 }, now), now);
    assert.equal(visitTime(now - 3 * 864e5, now), now);
    const summary = cleanSummary({ duration_ms: 5000, clicks: "3", junk: "y".repeat(1000), taps: -4 });
    assert.deepEqual(Object.keys(summary).includes("junk"), false);
    assert.equal(summary.duration_ms, 5000);
    assert.equal(summary.clicks, 3);
    assert.equal(summary.taps, 0);
    assert.equal(cleanSummary("nope"), undefined);
});

test("no query string is stored, from pages, hash routes or referrers", () => {
    assert.equal(cleanReferrer("https://search.example/?q=jane&email=jane@example.com"), "https://search.example/");
    assert.equal(cleanReferrer("https://app.example/#/route?token=abc"), "https://app.example/#/route");
    assert.equal(cleanReferrer("javascript:alert(1)"), null);
    assert.equal(cleanReferrer({}), null);
    assert.equal(groupPage("https://shop.example/app/#/weather?email=jane@example.com").page, "https://shop.example/app/#/weather");
    assert.equal(groupPage("https://shop.example/p?email=jane@example.com").page, "https://shop.example/p");
});
