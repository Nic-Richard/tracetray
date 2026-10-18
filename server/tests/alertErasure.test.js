const { test } = require("node:test");
const assert = require("node:assert/strict");
const { eraseAccountAlerts } = require("../src/lib/alertErasure");

function configured(t) {
    const previous = { url: process.env.ALERTS_URL, secret: process.env.ALERTS_SECRET };
    process.env.ALERTS_URL = "https://alerts.example.com/alert";
    process.env.ALERTS_SECRET = "fixture-secret";
    t.after(() => {
        if (previous.url === undefined) delete process.env.ALERTS_URL; else process.env.ALERTS_URL = previous.url;
        if (previous.secret === undefined) delete process.env.ALERTS_SECRET; else process.env.ALERTS_SECRET = previous.secret;
    });
}

test("account cleanup uses the configured relay with explicit app scope and resumable progress", async t => {
    configured(t);
    const calls = [];
    t.mock.method(globalThis, "fetch", async (url, init) => { calls.push([String(url), init]); return Response.json({ complete: false, cursor: { 123: "1003" } }); });
    const result = await eraseAccountAlerts(["account-12345678", "fixture@example.com"], { 123: "1009" });
    assert.deepEqual(result, { complete: false, cursor: { 123: "1003" } });
    assert.equal(calls[0][0], "https://alerts.example.com/erase");
    assert.equal(calls[0][1].headers.Authorization, "Bearer fixture-secret");
    assert.deepEqual(JSON.parse(calls[0][1].body), { app: "tracetray", references: ["account-12345678", "fixture@example.com"], cursor: { 123: "1009" } });
});

test("cleanup fails closed for unreachable, older or malformed relay responses", async t => {
    configured(t);
    for (const reply of [new Response(null, { status: 404 }), new Response(null, { status: 503 }), Response.json({}), Response.json({ complete: true, cursor: [] }), Response.json({ complete: true, cursor: { 123: "bad-cursor" } })]) {
        t.mock.method(globalThis, "fetch", async () => reply);
        await assert.rejects(eraseAccountAlerts(["account-12345678"]));
        t.mock.restoreAll();
    }
    t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
    await assert.rejects(eraseAccountAlerts(["account-12345678"]), /offline/);
});

test("unconfigured installations skip relay cleanup; partial configuration never silently skips it", async t => {
    configured(t);
    delete process.env.ALERTS_URL; delete process.env.ALERTS_SECRET;
    t.mock.method(globalThis, "fetch", () => { throw new Error("must not connect"); });
    assert.deepEqual(await eraseAccountAlerts(["account-12345678"]), { complete: true, cursor: {} });
    process.env.ALERTS_SECRET = "fixture-secret";
    await assert.rejects(eraseAccountAlerts(["account-12345678"]), /configuration/);
});
