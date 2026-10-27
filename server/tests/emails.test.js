const assert = require("node:assert/strict");
const { test } = require("node:test");
const { wantsWeeklySummary } = require("../src/jobs/weeklySummary");
const { weeklySummary, deletionNotice } = require("../src/lib/emailTemplates");
const { lastWeekStart } = require("../src/lib/weeklySummary");

test("the weekly summary comes with every plan unless turned off", () => {
    assert.equal(wantsWeeklySummary({ plan: "pro" }), true);
    assert.equal(wantsWeeklySummary({ plan: "enterprise" }), true);
    assert.equal(wantsWeeklySummary({ plan: "pro", email_prefs: { weekly_summary: false } }), false);
    assert.equal(wantsWeeklySummary({ plan: "starter" }), true);
    assert.equal(wantsWeeklySummary({ plan: "none", email_prefs: { weekly_summary: true } }), false);
});

test("unsubscribe links only verify for the account they were made for", () => {
    process.env.EMAIL_LINK_SECRET = "test-secret";
    delete require.cache[require.resolve("../src/lib/emailLinks")];
    const { sign, verify, unsubscribeUrl } = require("../src/lib/emailLinks");
    const token = sign("unsubscribe:weekly_summary", "abc123");
    assert.equal(verify("unsubscribe:weekly_summary", "abc123", token), true);
    assert.equal(verify("unsubscribe:weekly_summary", "someone-else", token), false);
    assert.equal(verify("unsubscribe:shift_alerts", "abc123", token), false, "a weekly-summary link can't turn off alerts");
    assert.equal(verify("unsubscribe:weekly_summary", "abc123", "x".repeat(token.length)), false);
    assert.equal(verify("unsubscribe:weekly_summary", "abc123", undefined), false);
    assert.equal(unsubscribeUrl("abc123", "shift_alerts"), `https://tracetray.com/email/unsubscribe?a=abc123&l=shift_alerts&t=${sign("unsubscribe:shift_alerts", "abc123")}`);
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

test("weekly runs take the busiest pages with new visits, within the plan's weekly allowance", () => {
    const { pickPages, weeklyPageCap } = require("../src/jobs/autoAnalysis");
    const pages = [
        { page: "a", sessions: 900, analysable: 400, last_seen: 2000 },
        { page: "b", sessions: 500, analysable: 300, last_seen: 1000 },
        { page: "c", sessions: 300, analysable: 10, last_seen: 3000 },
        { page: "d", sessions: 200, analysable: 100, last_seen: 3000 },
        { page: "e", sessions: 100, analysable: 50, last_seen: 3000 }
    ];
    const lastRuns = new Map([["b", 1500]]);
    const locked = new Set(["site|d"]);
    assert.deepEqual(pickPages(pages, lastRuns, locked, "site", 10).map(p => p.page), ["a", "e"]);
    assert.deepEqual(pickPages(pages, lastRuns, locked, "site", 1).map(p => p.page), ["a"]);
    assert.equal(weeklyPageCap({ plan: "starter" }), 0);
    assert.equal(weeklyPageCap({ plan: "ultra" }), 100);
    assert.equal(weeklyPageCap({ plan: "none" }), 0);
});

test("shift alerts name the page the way the dashboard does", () => {
    const { shiftAlert } = require("../src/lib/emailTemplates");
    const mail = shiftAlert({ shifts: [{ site: "Shop", page: "https://shop.example/products/:product", group: "Re-checkers", from: 0.2, to: 0.35 }], unsubscribe: null });
    assert.equal(mail.subject, "Visitors shifted on Product pages");
    assert.match(mail.text, /Product pages on Shop: Re-checkers went from 20% to 35% of visitors/);
});

test("CSV cells are quoted when needed and can't start a spreadsheet formula", () => {
    const { toCsv, cell } = require("../src/lib/csv");
    assert.equal(cell("/products/a,b"), '"/products/a,b"');
    assert.equal(cell('say "hi"'), '"say ""hi"""');
    assert.equal(cell("=HYPERLINK(\"http://x\")"), '"\'=HYPERLINK(""http://x"")"');
    assert.equal(cell("+1 page"), "'+1 page");
    assert.equal(cell("@sum"), "'@sum");
    assert.equal(cell(-3), "-3");
    assert.equal(cell(null), "");
    assert.equal(toCsv(["a", "b"], [[1, "x"]]), "a,b\r\n1,x\r\n");
});

test("the tracker never stores anything on the visitor's device", () => {
    const fs = require("node:fs");
    const tracker = fs.readFileSync(require("node:path").resolve(__dirname, "../../client/tracker.js"), "utf8");
    assert.doesNotMatch(tracker, /localStorage\.setItem|sessionStorage|document\.cookie|indexedDB/);
    assert.doesNotMatch(tracker, /visitor_id/, "visitor IDs come from the server");
});

test("journeys split after 30 minutes away, and each visitor ID keeps its own journey", () => {
    const { splitJourneys } = require("../src/lib/siteData");
    const min = 60 * 1000, t = Date.parse("2026-10-15T12:00:00Z");
    const journeys = splitJourneys([
        { visitor_id: "a", page: "/", start_time: t, end_time: t + 2 * min },
        { visitor_id: "b", page: "/pricing", start_time: t + min, end_time: new Date(t + 3 * min).toISOString() },
        { visitor_id: "a", page: "/cart", start_time: t + 20 * min, end_time: t + 21 * min },
        { visitor_id: "a", page: "/", start_time: t + 60 * min, end_time: t + 61 * min },
        { visitor_id: "b", page: "/signup", start_time: t + 25 * min, end_time: t + 26 * min }
    ]);
    assert.deepEqual(journeys, [["/", "/cart"], ["/pricing", "/signup"], ["/"]]);
});

test("the weekly email reports each goal, with best weeks, targets, milestones and wins only when earned", () => {
    const site = {
        name: "Shop", visits: 1200, change: 0.1, mobileShare: 0.4, topPages: [], mover: null, shifts: [],
        goals: [
            { name: "Checkout", rate: 0.041, previous: 0.036, bestWeek: true, targetMet: 0.04, milestone: 1000 },
            { name: "<b>Signup</b>", rate: 0.12, previous: null, bestWeek: false, targetMet: null, milestone: null }
        ],
        wins: [{ page: "https://shop.example/", day: "2026-10-05", note: "New hero", goal: "Checkout", before: 0.031, after: 0.046 }]
    };
    const email = weeklySummary({ from: "2026-10-05", to: "2026-10-11", sites: [site] });
    assert.match(email.text, /Checkout: 4\.1% of visits reached it, against 3\.6% the week before\. Your best week yet\. That's at or above your 4\.0% target\. It has now been reached 1,000 times\./);
    assert.match(email.text, /<b>Signup<\/b>: 12% of visits reached it\./);
    assert.ok(!email.html.includes("<b>Signup</b>"));
    assert.match(email.text, /Around your change to Home on October 5, 2026 \(New hero\), Checkout rose from 3\.1% to 4\.6%\./);
    assert.match(email.text, /doesn't establish that the change caused it/);
    assert.doesNotMatch(email.text, /A win/);
});

test("milestones count the biggest round number a goal passed", () => {
    const { milestoneCrossed, nextMilestone } = require("../src/lib/goalHits");
    assert.equal(milestoneCrossed(95, 130), 100);
    assert.equal(milestoneCrossed(130, 990), null);
    assert.equal(milestoneCrossed(90, 1200), 1000);
    assert.equal(nextMilestone(130), 1000);
});
