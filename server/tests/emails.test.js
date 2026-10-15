const assert = require("node:assert/strict");
const { test } = require("node:test");
const { wantsWeeklySummary } = require("../src/jobs/weeklySummary");
const { weeklySummary, deletionNotice } = require("../src/lib/emailTemplates");
const { lastWeekStart } = require("../src/lib/weeklySummary");

test("the weekly summary is Pro's once plans are live, and opt-in during the beta", () => {
    assert.equal(wantsWeeklySummary({ plan: "pro" }, "production"), true);
    assert.equal(wantsWeeklySummary({ plan: "enterprise" }, "production"), true);
    assert.equal(wantsWeeklySummary({ plan: "pro", email_prefs: { weekly_summary: false } }, "production"), false);
    assert.equal(wantsWeeklySummary({ plan: "starter", email_prefs: { weekly_summary: true } }, "production"), false);
    assert.equal(wantsWeeklySummary({ plan: "none" }, "beta"), false);
    assert.equal(wantsWeeklySummary({ plan: "none", email_prefs: { weekly_summary: true } }, "beta"), true);
});

test("unsubscribe links only verify for the account they were made for", () => {
    process.env.EMAIL_LINK_SECRET = "test-secret";
    delete require.cache[require.resolve("../src/lib/emailLinks")];
    const { sign, verify, unsubscribeUrl } = require("../src/lib/emailLinks");
    const token = sign("unsubscribe", "abc123");
    assert.equal(verify("unsubscribe", "abc123", token), true);
    assert.equal(verify("unsubscribe", "someone-else", token), false);
    assert.equal(verify("unsubscribe", "abc123", "x".repeat(token.length)), false);
    assert.equal(verify("unsubscribe", "abc123", undefined), false);
    assert.match(unsubscribeUrl("abc123"), /^https:\/\/tracetray\.com\/email\/unsubscribe\?a=abc123&t=/);
});

test("weeks run Monday to Sunday and the email escapes what site owners typed", () => {
    assert.equal(new Date(lastWeekStart(Date.parse("2026-10-19T13:00:00Z"))).toISOString().slice(0, 10), "2026-10-12");
    const mail = weeklySummary({
        from: "2026-10-12", to: "2026-10-18", unsubscribe: "https://tracetray.com/email/unsubscribe?a=1&t=x",
        sites: [{ name: "<b>Shop</b>", visits: 1200, change: 0.12, mobileShare: 0.4, topPages: [{ page: "https://shop.example/", visits: 500 }], mover: null,
            shifts: [{ page: "https://shop.example/products/:product", group: "Quick deciders", from: 0.3, to: 0.44, delta: 0.14 }] }]
    });
    assert.equal(mail.subject, "Your week on TraceTray: 1,200 visits, up 12%");
    assert.doesNotMatch(mail.html, /<b>Shop<\/b>/);
    assert.match(mail.html, /&lt;b&gt;Shop/);
    assert.match(mail.text, /Quick deciders went from 30% to 44%/);
    assert.match(mail.text, /Stop these weekly emails/);
    assert.match(deletionNotice({ siteNames: ["A"], deleteOn: "2026-11-20" }).subject, /November 20, 2026/);
});

test("a change isn't compared until a full day has passed since it", async () => {
    const { compareAroundChange } = require("../src/lib/compare");
    const now = Date.parse("2026-10-14T18:00:00Z");
    assert.deepEqual(await compareAroundChange("site", "page", "2026-10-14", now), { ready: false, days: 0 });
    assert.deepEqual(await compareAroundChange("site", "page", "not-a-day", now), { ready: false, days: 0 });
});
