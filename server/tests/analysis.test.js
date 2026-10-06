const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { runProcess } = require("../src/lib/runProcess");

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
    const fakeProcess = { env: { TRACETRAY_SITE_KEY: "tt_test" } };
    const mongoose = {
        async connect() { if (stage === "connect") throw new Error("offline"); },
        Schema: class {},
        model() { return { async find() { if (stage === "query") throw new Error("offline"); return []; } }; },
        connection: { async close() { observed.closed = true; } },
    };
    const code = fs.readFileSync(path.resolve(__dirname, "../../analysis/extractFeatures.js"), "utf8");
    await vm.runInNewContext(code, {
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
    assert.equal(fakeProcess.exitCode, 1);
    assert.equal(observed.closed, true);
    assert.equal(observed.writes, stage === "write" ? 1 : 0);
}

for (const stage of ["connect", "query", "write"]) {
    test(`extraction reports ${stage} failures with a failed exit`, () => extractFailure(stage));
}

function analysisHandler({ failProcess = false, failSave = false, busy = false, mobileFails = false } = {}) {
    const state = { running: { tt_test: busy }, processes: 0, permits: 0, saves: 0, ai: 0 };
    let handler;
    const code = fs.readFileSync(path.resolve(__dirname, "../src/routes/analysis.js"), "utf8");
    const cluster = { session_count: 10, clusters: [] };
    const userId = "user_test";
    vm.runInNewContext(code, {
        require(name) {
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
                Account: { findOne: () => ({ lean: async () => ({ plan: "pro" }) }) },
                AnalysisResult: {
                    findOne: () => ({ sort: () => ({ lean: async () => null }) }),
                    async create() { state.saves++; if (failSave) throw new Error("save failed"); },
                },
            };
            if (name === "../lib/siteAccount") return { resolveSiteKey: () => "tt_test" };
            if (name === "../lib/clickSummary") return { getClickSummary: async () => ({}) };
            if (name === "../lib/aiInterpretation") return { callAI() { state.ai++; throw new Error("unexpected paid call"); } };
            if (name === "../lib/analysisState") return {
                analysisRunning: state.running,
                lastAICallByUser: { [`${userId}::tt_test::all`]: Date.now() },
                AI_COOLDOWN_MS: 60 * 1000,
                consumeAnalysisPermit() { state.permits++; return true; },
            };
            if (name === "../config") return { TRACETRAY_MODE: "beta" };
            if (name === "../lib/logger") return { debug() {}, info() {}, error() {} };
            return {};
        },
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
    assert.equal(state.ai, 0);
    assert.equal(state.running.tt_test, false);
});
