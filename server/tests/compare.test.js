const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { findingSnapshot, goalSnapshot, goalForChange } = require("../src/lib/changeFinding");

function load(file, dependencies) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src", file), "utf8"), {
        module, Date, require: name => {
            assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
            return dependencies[name];
        }
    });
    return module.exports;
}

const goal = { id: "buy", name: "Buy", type: "click", match: { text: "Buy" }, pages: ["/products"], backfill: "done" };
const reference = { ran_at: "2026-10-01T12:00:00.000Z", device: "desktop", group: "Steady", action: "Try moving the button" };
function analysis() {
    return { page: "/products", ran_at: reference.ran_at, session_count: 200, inactive_count: 12, structure: "clear",
        clusters: [{ id: 0, n: 200 }], goal: { id: "buy", name: "Buy" },
        scope: { from: "2026-09-01T00:00:00Z", to: reference.ran_at, excluded_detail: 7, excluded_events: 4, window_days: 90, limit: 20000, at_limit: false },
        interpretation: { advice: [{ action: reference.action, group: reference.group, device: "desktop", evidence: "They scroll less." }] } };
}

test("finding snapshots come from saved evidence, not request text, and preserve scope", () => {
    const saved = analysis();
    const snapshot = findingSnapshot(saved, { ...reference, evidence: "Invented" });
    assert.equal(snapshot.evidence, "They scroll less.");
    assert.equal(snapshot.scope.excluded_detail, 7);
    assert.equal(snapshot.inactive_count, 12);
    assert.equal(findingSnapshot(saved, { ...reference, action: "Invented" }), null);
    assert.equal(findingSnapshot(saved, { ...reference, device: "mobile" }), null);
    assert.equal(findingSnapshot({ ...saved, structure: "none" }, reference), null);
    assert.equal(findingSnapshot({ ...saved, session_count: 99 }, reference), null);
    const record = JSON.parse(JSON.stringify(snapshot));
    saved.interpretation.advice[0].evidence = "Refreshed";
    assert.equal(record.evidence, "They scroll less.");
});

test("merged findings retain both scopes while pinning the chosen device", () => {
    const saved = analysis();
    saved.mobile = { session_count: 150, inactive_count: 6, clusters: [{ id: 0, n: 150 }], structure: "clear", scope: saved.scope };
    saved.interpretation.advice[0].devices = ["desktop", "mobile"];
    const snapshot = findingSnapshot(saved, { ...reference, device: "mobile" });
    assert.equal(snapshot.device, "mobile");
    assert.equal(snapshot.session_count, 150);
    assert.equal(snapshot.related_scopes[0].device, "desktop");
    assert.equal(snapshot.related_scopes[0].session_count, 200);
});

test("goal snapshots survive a main-goal switch and pause after edits, removal or recount", () => {
    const change = { goal_snapshot: goalSnapshot(goal) };
    const site = { goals: [goal], main_goals: [{ page: "/products", goal: "other" }] };
    assert.equal(goalForChange(site, change).goal.id, "buy");
    assert.equal(goalForChange({ goals: [] }, change).goal_status, "changed");
    for (const edit of [{ match: { text: "Checkout" } }, { pages: [] }, { type: "page" }, { measurement_version: 1 }]) {
        assert.equal(goalForChange({ goals: [{ ...goal, ...edit }] }, change).goal_status, "changed");
    }
    for (const backfill of ["queued", "running", "failed"]) {
        assert.equal(goalForChange({ goals: [{ ...goal, backfill }] }, change).goal_status, "backfilling");
    }
    assert.equal(goalForChange(site, { goal_snapshot: null }).goal_status, "none");
});

test("the account schema retains finding and goal snapshots without a database write", async () => {
    const { Account } = require("../src/db/models");
    const finding = findingSnapshot(analysis(), reference);
    const account = new Account({ site_key: "tt", email: "fixture@example.test", sites: [{ key: "tt", name: "Fixture",
        goals: [{ ...goal, measurement_version: 3 }],
        page_changes: [{ id: "record", page: "/products", day: "2026-10-02", note: "Moved Buy", finding, goal_snapshot: goalSnapshot(goal), comparison_version: 2 }] }] });
    await account.validate();
    const saved = JSON.parse(JSON.stringify(account));
    assert.equal(saved.sites[0].goals[0].measurement_version, 3);
    assert.equal(saved.sites[0].page_changes[0].finding.scope.excluded_events, 4);
    assert.equal(saved.sites[0].page_changes[0].goal_snapshot.match.text, "Buy");
    assert.equal(saved.sites[0].page_changes[0].comparison_version, 2);
});

function comparisons() {
    const queries = [];
    const lib = load("lib/compare.js", {
        "../db/models": { Session: { async aggregate(pipeline) {
            queries.push(pipeline[0].$match);
            return [{ visits: 1000, mobile: 0, engaged: 400, duration: 10000, actions: 2, depth: 0.5, reached: queries.length % 2 ? 100 : 300 }];
        } }, AnalysisResult: { findOne() { throw new Error("Linked follow-ups must not use overlapping group snapshots"); } } },
        "./groupShifts": { groupShares: () => null }, "./tracking": { ENGAGED: {} }
    });
    return { lib, queries };
}

test("comparisons exclude the change day, use complete UTC days and pin the device", async () => {
    const { lib, queries } = comparisons();
    const at = day => Date.parse(`${day}T00:00:00Z`);
    assert.equal((await lib.compareAroundChange("tt", "/products", "2026-10-01", at("2026-10-02") + 86399999, goal, "mobile")).ready, false);
    assert.equal(queries.length, 0);
    const first = await lib.compareAroundChange("tt", "/products", "2026-10-01", at("2026-10-03"), goal, "mobile");
    assert.equal(first.days, 1);
    assert.equal(first.provisional, true);
    assert.equal(first.goal.verdict, "unclear");
    assert.equal(queries[0].start_time.$gte, at("2026-09-30"));
    assert.equal(queries[0].start_time.$lt, at("2026-10-01"));
    assert.equal(queries[1].start_time.$gte, at("2026-10-02"));
    assert.equal(queries[1].start_time.$lt, at("2026-10-03"));
    assert.equal(queries[0].device_type, "mobile");
    assert.equal(queries[0].site_key, "tt");
    assert.equal(queries[0].page, "/products");
    const final = await lib.compareAroundChange("tt", "/products", "2026-10-01", at("2026-10-16"), goal, "desktop");
    assert.equal(final.days, 14);
    assert.equal(final.provisional, false);
    assert.equal(final.goal.verdict, "better");
    assert.equal(final.goal.before_reached, 100);
    assert.equal(final.goal.after_reached, 300);
    assert.equal(queries[2].device_type.$ne, "mobile");
    const late = await lib.compareAroundChange("tt", "/products", "2026-10-01", at("2026-11-15"), goal, "desktop");
    assert.equal(late.days, 14);
    assert.equal(queries[5].start_time.$lt, at("2026-10-16"));
});

test("goal uncertainty handles zero/all conversions and insufficient visits", () => {
    const { lib } = comparisons();
    const row = (goalReached, visits = 1000) => ({ goalReached, visits });
    assert.equal(lib.goalVerdict(row(100), row(300)), "better");
    assert.equal(lib.goalVerdict(row(300), row(100)), "worse");
    assert.equal(lib.goalVerdict(row(100), row(100)), "same");
    assert.equal(lib.goalVerdict(row(10), row(15)), "unclear");
    assert.equal(lib.goalVerdict(row(20, 20), row(300)), "unclear");
    assert.equal(lib.goalDifferenceInterval(row(0, 0), row(1)), null);
    for (const reached of [0, 1000]) {
        const interval = lib.goalDifferenceInterval(row(reached), row(reached));
        assert.ok(interval[0] < 0 && interval[1] > 0);
    }
});

function routes({ owned = true, saved = analysis(), selectedGoal = goal, locked = false, plan = true } = {}) {
    const handlers = new Map(), queries = [];
    const site = { key: "tt", goals: [selectedGoal], page_changes: [] };
    const observed = { saves: 0, queries, site };
    const account = { sites: owned ? [site] : [], plan: "pro", async save() { observed.saves++; } };
    const router = { get(route, ...fns) { handlers.set(`GET ${route}`, fns.at(-1)); }, post(route, ...fns) { handlers.set(`POST ${route}`, fns.at(-1)); }, delete() {} };
    load("routes/compare.js", {
        express: { Router: () => router }, crypto: { randomBytes: () => Buffer.from("record") },
        "@clerk/express": { getAuth: () => ({ userId: "owner" }) }, "../middleware/auth": { requireAuth: () => () => {} },
        "../db/models": { Account: { findOne: async query => { queries.push(query); return account; } },
            AnalysisResult: { findOne: query => { queries.push(query); return { lean: async () => saved }; } } },
        "../lib/siteAccount": { resolveSiteKey: () => "tt" }, "../lib/compare": { compareAroundChange: async (...args) => { observed.compared = args; return { ready: false }; } },
        "../lib/goalHits": { mainGoalFor: async () => goal }, "../lib/changeFinding": { findingSnapshot, goalSnapshot, goalForChange },
        "../lib/limits": { isPageLocked: async () => locked }, "../lib/plans": { planLimits: () => plan ? {} : null }, "../lib/logger": { error: () => {} }
    });
    async function request(method, route, { body = {}, query = {} } = {}) {
        const res = { code: 200, status(value) { this.code = value; return this; }, json(value) { this.body = value; return this; } };
        await handlers.get(`${method} ${route}`)({ body, query }, res);
        return res;
    }
    return { observed, request };
}

test("recording resolves evidence within the owned site/page and pins it with the goal", async () => {
    const { request, observed } = routes();
    const preview = await request("GET", "/api/change-finding", { query: { page: "/products", ...reference } });
    assert.equal(preview.body.evidence, "They scroll less.");
    const result = await request("POST", "/api/page-changes", { body: { page: "/products", day: "2026-10-02", note: "Moved Buy above the details", source: reference, finding: { evidence: "Invented" } } });
    assert.equal(result.code, 201);
    assert.equal(observed.saves, 1);
    assert.equal(result.body.finding.evidence, "They scroll less.");
    assert.equal(result.body.goal_snapshot.id, "buy");
    assert.equal(observed.queries[0].clerk_user_id, "owner");
    const query = observed.queries.find(q => q.ran_at);
    assert.equal(query.site_key, "tt");
    assert.equal(query.page, "/products");
    assert.equal(query.ran_at.toISOString(), reference.ran_at);
    const listed = await request("GET", "/api/page-changes", { query: { page: "/products" } });
    assert.equal(listed.body[0].finding.evidence, "They scroll less.");
    await request("GET", "/api/compare", { query: { page: "/products", day: "2026-10-02", change: result.body.id } });
    assert.equal(observed.compared[4].id, "buy");
    assert.equal(observed.compared[5], "desktop");
    assert.equal((await request("GET", "/api/compare", { query: { page: "/other", day: "2026-10-02", change: result.body.id } })).code, 404);
});

test("recording rejects invalid dates, empty notes, stale findings and unowned sites without writes", async () => {
    const { request, observed } = routes();
    const body = { page: "/products", day: "2026-10-02", note: "Moved Buy", source: reference };
    for (const edit of [{ day: "2026-02-30" }, { day: "2026-09-30" }, { day: "2999-01-01" }, { note: "  " }, { source: { ...reference, action: "Made up" } }]) {
        assert.equal((await request("POST", "/api/page-changes", { body: { ...body, ...edit } })).code, 400);
    }
    assert.equal(observed.saves, 0);
    const unowned = routes({ owned: false });
    assert.equal((await unowned.request("POST", "/api/page-changes", { body })).code, 403);
    assert.equal((await unowned.request("GET", "/api/change-finding", { query: { page: "/products", ...reference } })).code, 403);
    assert.equal(unowned.observed.saves, 0);
    const expired = routes({ saved: null });
    assert.equal((await expired.request("POST", "/api/page-changes", { body })).code, 400);
    for (const options of [{ selectedGoal: { ...goal, backfill: "running" } }, { selectedGoal: { ...goal, backfill_at: "2026-10-02T00:00:00Z" } }]) {
        const changed = routes(options);
        assert.equal((await changed.request("POST", "/api/page-changes", { body })).code, 400);
        assert.equal(changed.observed.saves, 0);
    }
    for (const options of [{ locked: true }, { plan: false }]) {
        const blocked = routes(options);
        assert.equal((await blocked.request("POST", "/api/page-changes", { body })).code, 403);
        assert.equal((await blocked.request("GET", "/api/change-finding", { query: { page: "/products", ...reference } })).code, 403);
        assert.equal(blocked.observed.saves, 0);
    }
});
