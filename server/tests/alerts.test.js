const test = require("node:test");
const assert = require("node:assert/strict");
const { sendAlert, errorAlert } = require("../src/lib/alerts");

function capture(t) {
    const calls = [];
    t.mock.method(globalThis, "fetch", async (url, init) => {
        calls.push({ url, auth: init.headers.Authorization, body: JSON.parse(init.body) });
        return new Response("{}", { status: 202 });
    });
    return calls;
}

test("sends nothing until the relay is configured", (t) => {
    const calls = capture(t);
    delete process.env.ALERTS_URL;
    sendAlert("bugs", { title: "x" });
    assert.equal(calls.length, 0);
});

test("posts alerts and logged errors to the relay", (t) => {
    const calls = capture(t);
    process.env.ALERTS_URL = "https://alerts.test/alert";
    process.env.ALERTS_SECRET = "s".repeat(40);
    t.after(() => {
        delete process.env.ALERTS_URL;
        delete process.env.ALERTS_SECRET;
    });

    sendAlert("bugs", { title: "Bug report" });
    errorAlert(["stats error:", new Error("boom")]);

    assert.equal(calls[0].auth, `Bearer ${"s".repeat(40)}`);
    assert.deepEqual(calls[0].body, { app: "tracetray", type: "bugs", title: "Bug report" });
    assert.equal(calls[1].body.type, "errors");
    assert.equal(calls[1].body.title, "stats error: boom");
    assert.equal(calls[1].body.key, "stats error:");
    assert.match(calls[1].body.description, /Error: boom/);
});
