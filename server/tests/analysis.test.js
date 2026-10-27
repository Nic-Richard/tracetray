const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { runProcess } = require("../src/lib/runProcess");

test("saved rule-based analyses get current wording on read without rewriting stored results", async () => {
    const saved = { site_key: "tt_test", page: "/products", session_count: 100, structure: "none", clusters: [{ id: 0, n: 100, feature_means: {} }],
        interpretation: { source: "rules", site_summary: "Visitors behave alike", first_impression_note: "Numeric first-impression note" } };
    let query;
    const lib = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../src/lib/siteData.js"), "utf8"), {
        require(name) {
            if (name === "../db/models") return { AnalysisResult: { findOne(filter) {
                query = filter;
                return { sort: () => ({ lean: async () => structuredClone(saved) }) };
            } } };
            if (name === "./interpretClusters") return require("../src/lib/interpretClusters");
            return {};
        },
        module: lib,
    });
    const result = await lib.exports.latestAnalysis("tt_test", "/products");
    assert.equal(query.site_key, "tt_test");
    assert.equal(query.page, "/products");
    assert.match(result.interpretation.site_summary, /^No reliable groups found/);
    assert.equal(result.interpretation.first_impression_note, null);
    assert.equal(saved.interpretation.site_summary, "Visitors behave alike");
});

test("process output is returned only on a successful exit", async () => {
    const result = await runProcess(process.execPath, ["-e", "console.log('done')"]);
    assert.equal(result.stdout.trim(), "done");
    await assert.rejects(runProcess(process.execPath, ["-e", "process.exit(1)"]), /failed/);
});

test("missing executables and stalled children reject", async () => {
    await assert.rejects(runProcess("tracetray-missing-executable", []), { code: "ENOENT" });
    await assert.rejects(runProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 200 }), /timed out/);
});

test("unbounded process output is stopped", async () => {
    await assert.rejects(runProcess(process.execPath, ["-e", "process.stdout.write('x'.repeat(2 * 1024 * 1024))"]), /too large/);
});

async function extractFailure(stage) {
    const observed = { writes: 0, closed: false };
    let finished;
    const done = new Promise(resolve => { finished = resolve; });
    const fakeProcess = { env: { TRACETRAY_SITE_KEY: "tt_test" } };
    const mongoose = {
        async connect() { if (stage === "connect") throw new Error("offline"); },
        Schema: class {},
        model() {
            return {
                find() {
                    const rows = { async *[Symbol.asyncIterator]() { if (stage === "query") throw new Error("offline"); } };
                    const query = { sort: () => query, limit: () => query, lean: () => query, cursor: () => rows };
                    return query;
                },
                async aggregate() { return []; }
            };
        },
        connection: { async close() { observed.closed = true; finished(); } },
    };
    const code = fs.readFileSync(path.resolve(__dirname, "../../analysis/extractFeatures.js"), "utf8");
    vm.runInNewContext(code, {
        require(name) {
            if (name === "mongoose") return mongoose;
            if (name === "path") return path;
            if (name === "fs") return {
                mkdirSync() {}, readdirSync() { return []; },
                writeFileSync() { observed.writes++; throw new Error("disk full"); },
            };
            return () => ({});
        },
        __dirname: path.resolve(__dirname, "../../analysis"),
        process: fakeProcess,
        console: { log() {}, error() {} },
    });
    await done;
    assert.equal(fakeProcess.exitCode, 1);
    assert.equal(observed.closed, true);
    assert.equal(observed.writes, stage === "write" ? 1 : 0);
}

for (const stage of ["connect", "query", "write"]) {
    test(`extraction reports ${stage} failures with a failed exit`, () => extractFailure(stage));
}

function analysisHandler({ failProcess = false, failSave = false, busy = false, mobileFails = false, closing = false } = {}) {
    const state = { running: { tt_test: busy }, processes: 0, permits: 0, saves: 0, ai: 0, interpreted: 0 };
    let handler;
    const code = fs.readFileSync(path.resolve(__dirname, "../src/routes/analysis.js"), "utf8");
    const cluster = { session_count: 10, clusters: [] };
    const userId = "user_test";
    // The route hands the run to lib/runAnalysis, which is loaded for real with the same fakes.
    const loadRunAnalysis = () => {
        const lib = { exports: {} };
        vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../src/lib/runAnalysis.js"), "utf8"), {
            require: name => fakeRequire(name.startsWith("./") ? `../lib/${name.slice(2)}` : name),
            __dirname: path.resolve(__dirname, "../src/lib"),
            module: lib, process,
        });
        return lib.exports;
    };
    const fakeRequire = name => {
            if (name === "../lib/runAnalysis") return loadRunAnalysis();
            if (name === "express") return { Router: () => ({ post(route, auth, fn) { if (route === "/api/run-analysis") handler = fn; } }) };
            if (name === "path") return path;
            if (name === "@clerk/express") return { getAuth: () => ({ userId }) };
            if (name === "../middleware/auth") return { requireAuth: () => () => {} };
            if (name === "../lib/runProcess") return { async runProcess() {
                state.processes++;
                if (failProcess || (mobileFails && state.processes === 3)) throw new Error("process failed");
                return { stdout: `TRACETRAY_RESULT: ${JSON.stringify(cluster)}` };
            } };
            if (name === "../db/models") return {
                Account: { findOne: () => ({ lean: async () => ({ plan: "pro" }) }), exists: async () => !closing },
                Session: { findOne: () => ({ sort: () => ({ lean: async () => null }) }) },
                AnalysisResult: {
                    findOne: () => ({ sort: () => ({ lean: async () => null }) }),
                    async create() { state.saves++; if (failSave) throw new Error("save failed"); },
                },
            };
            if (name === "../lib/siteAccount") return { resolveSiteKey: () => "tt_test" };
            if (name === "../lib/attentionProfile") return { computeAttentionProfile: async () => ({}) };
            if (name === "../lib/clickSummary") return { getClickSummary: async () => ({}) };
            if (name === "../lib/aiInterpretation") { state.ai++; return {}; }
            if (name === "../lib/interpretClusters") return { interpretClusters() { state.interpreted++; return { source: "rules" }; } };
            if (name === "../lib/analysisState") return {
                analysisRunning: state.running,
                consumeAnalysisPermit() { state.permits++; return true; },
            };
            if (name === "../lib/groupTracking") return { trackGroups: (previous, current) => current };
            if (name === "../lib/logger") return { debug() {}, info() {}, error() {} };
            return {};
    };
    vm.runInNewContext(code, {
        require: fakeRequire,
        __dirname: path.resolve(__dirname, "../src/routes"),
        module: { exports: {} }, process,
    });
    return { state, handler };
}

function response() {
    return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test("failed extraction stops before clustering, AI, or saving and releases the site", async () => {
    const { handler, state } = analysisHandler({ failProcess: true });
    const res = response();
    await handler({ body: { permit_token: "test" } }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(state.processes, 1);
    assert.equal(state.saves, 0);
    assert.equal(state.ai, 0);
    assert.equal(state.running.tt_test, false);
});

test("a save failure releases the site and returns an error", async () => {
    const { handler, state } = analysisHandler({ failSave: true });
    const res = response();
    await handler({ body: { permit_token: "test" } }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(state.saves, 1);
    assert.equal(state.running.tt_test, false);
});

test("a busy site does not consume the refresh permit", async () => {
    const { handler, state } = analysisHandler({ busy: true });
    const res = response();
    await handler({ body: { permit_token: "test" } }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(state.permits, 0);
    assert.equal(state.processes, 0);
});

test("desktop results are saved when optional mobile analysis fails", async () => {
    const { handler, state } = analysisHandler({ mobileFails: true });
    const res = response();
    await handler({ body: { permit_token: "test" } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(state.saves, 1);
    assert.equal(state.interpreted, 1);
    assert.equal(state.ai, 0);
    assert.equal(state.running.tt_test, false);
});

test("a closing account cannot start an analysis or recreate its results", async () => {
    const { handler, state } = analysisHandler({ closing: true });
    const res = response();
    await handler({ body: { permit_token: "test" } }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(state.processes, 0);
    assert.equal(state.saves, 0);
    assert.equal(state.running.tt_test, false);
});

test("goal windows never include the goal itself and both sides use the same windows", async () => {
    const start = 1_000_000;
    const click = (t, text) => ({ type: "click", timestamp: start + t, target: { text } });
    const sessions = [
        { session_id: "buyer", device_type: "desktop", start_time: start, end_time: start + 60000, goal_hits: ["g"],
          events: [click(3000, "Size guide"), click(25000, "Add to cart"), click(40000, "Reviews")] },
        { session_id: "browser", device_type: "desktop", start_time: start, end_time: start + 60000, goal_hits: [],
          events: [click(3000, "Size guide"), click(50000, "Reviews")] },
    ];
    const written = {};
    let finished;
    const done = new Promise(resolve => { finished = resolve; });
    const mongoose = {
        async connect() {},
        Schema: class {},
        model: () => ({
            find(filter) {
                const rows = filter.device_type === "mobile" ? [] : sessions;
                const query = { sort: () => query, limit: () => query, lean: () => query, cursor: () => ({ async *[Symbol.asyncIterator]() { yield* rows; } }) };
                return query;
            },
            async aggregate() { return []; }
        }),
        connection: { async close() { finished(); } },
    };
    const clicks = session => ({ clicks: (session.events || []).filter(e => e.type === "click").map(e => e.target.text) });
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../analysis/extractFeatures.js"), "utf8"), {
        require(name) {
            if (name === "mongoose") return mongoose;
            if (name === "path") return path;
            if (name === "fs") return { mkdirSync() {}, readdirSync() { return []; }, writeFileSync(file, body) { written[path.basename(file)] = body; } };
            if (name === "../server/src/lib/goals") return require("../src/lib/goals");
            return clicks;
        },
        __dirname: path.resolve(__dirname, "../../analysis"),
        process: { env: { TRACETRAY_SITE_KEY: "tt_test", TRACETRAY_GOAL: JSON.stringify({ id: "g", type: "click", match: { text: "Add to cart" } }) } },
        console: { log() {}, error() {} },
    });
    await done;
    const rows = Object.fromEntries(JSON.parse(written["dataset_tt_test_desktop.json"]).map(r => [r.session_id, r]));
    assert.equal(rows.buyer.goal_after_ms, 25000);
    assert.deepEqual(Object.keys(rows.buyer.windows), ["5", "10", "20"]);
    assert.ok(Object.values(rows.buyer.windows).every(w => !w.clicks.includes("Add to cart")));
    assert.deepEqual(Object.keys(rows.browser.windows), ["5", "10", "20", "40"]);
    assert.equal(rows.browser.goal_after_ms, null);
    const meta = JSON.parse(written["dataset_tt_test_meta.json"]);
    assert.equal(meta.desktop.scope.from, new Date(start).toISOString());
    assert.ok(Date.parse(meta.desktop.scope.to) > start);
    assert.equal(meta.desktop.scope.window_days, 90);
    assert.equal(meta.desktop.scope.limit, 20000);
    assert.equal(meta.desktop.scope.at_limit, false);
    assert.equal(meta.desktop.scope.excluded_detail, 0);
    assert.equal(meta.desktop.scope.excluded_events, 0);
});
