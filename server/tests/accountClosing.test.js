const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function load(file, dependencies) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src", file), "utf8"), {
        module, process, require: name => {
            assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
            return dependencies[name];
        }
    });
    return module.exports;
}
function response() {
    return { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
}

test("closing guard blocks authenticated dashboard access but preserves configuration and deletion status", async () => {
    const { createAccountClosing } = load("middleware/accountClosing.js", {
        "@clerk/express": {}, "../db/models": {}
    });
    const checked = [];
    const middleware = createAccountClosing({ userId: req => req.user, requested: async id => { checked.push(id); return id === "closing"; } });
    for (const [url, user, blocked] of [["/api/account", "closing", true], ["/api/sites", "closing", true], ["/api/account", "other", false], ["/api/account", null, false], ["/api/config", "closing", false], ["/api/account-deletion", "closing", false], ["/delete-account", "closing", false], ["/webhook/stripe", "closing", false]]) {
        let next = false; const res = response();
        await middleware({ path: url, user }, res, () => { next = true; });
        assert.equal(next, !blocked);
        if (blocked) { assert.equal(res.code, 410); assert.equal(res.body.account_deleting, true); }
    }
    assert.ok(!checked.includes(null));
});

test("deletion routes use the signed-in identity and never a submitted target", async () => {
    const routes = {};
    const calls = [];
    load("routes/accountDeletion.js", {
        express: { Router: () => ({ get: (url, auth, handler) => { routes.GET = handler; }, post: (url, auth, handler) => { routes.POST = handler; } }) },
        "@clerk/express": { getAuth: req => ({ userId: req.user }) },
        "../middleware/auth": { requireAuth: () => () => {} },
        "../db/models": { AccountDeletion: { findOne: filter => ({ lean: async () => { calls.push(filter.clerk_user_id); return { state: "pending" }; } }) } },
        "../lib/accountDeletion": { deletionStatus: value => value },
        "../jobs/accountDeletion": { service: { request: async (...args) => { calls.push(args); return { status: 202, body: { state: "pending" } }; } } }
    });
    const req = { user: "signed-in", body: { confirmation: "DELETE", user_id: "victim", account_id: "victim" } };
    const res = response();
    await routes.POST(req, res); await routes.GET(req, response());
    assert.equal(res.code, 202);
    assert.deepEqual(calls, [["signed-in", "DELETE"], "signed-in"]);
});

function billingFixture() {
    const routes = {}; const calls = [];
    const stripe = {
        prices: { list: async () => ({ data: [{ id: "price" }] }) },
        checkout: { sessions: { create: async () => ({ id: "checkout", url: "https://checkout.stripe.com/test" }), expire: async id => calls.push(["expire", id]) } },
        webhooks: { constructEvent: body => body },
        subscriptions: { retrieve: async () => ({ id: "subscription", status: "trialing" }), cancel: async (id, options) => calls.push(["cancel", id, options]) }
    };
    load("routes/billing.js", {
        express: { Router: () => ({ post: (url, ...handlers) => { routes[url] = handlers.at(-1); } }) },
        "@clerk/express": { getAuth: () => ({ userId: "closing" }) },
        "../middleware/auth": { requireAuth: () => () => {} },
        "../lib/stripe": stripe,
        "../db/models": { Account: { findOne: async () => ({ email: "unused@example.com" }), updateOne: async () => { calls.push(["activate"]); return { matchedCount: 1 }; } }, AccountDeletion: { exists: async () => true } },
        "../config": { TRACETRAY_MODE: "production" },
        "../lib/logger": { error() {}, info() {}, warn() {} },
        "../lib/alerts": { sendAlert() { calls.push(["alert"]); } },
        "../lib/plans": { PRICE_KEYS: { pro: { month: "pro-month" } }, planForPrice: () => "pro" }
    });
    return { routes, calls };
}

test("checkout creation racing a deletion expires the new checkout without returning its link", async () => {
    const { routes, calls } = billingFixture(); const res = response();
    await routes["/api/create-checkout-session"]({ body: { plan: "pro" }, protocol: "https", get: () => "tracetray.com" }, res);
    assert.equal(res.code, 410); assert.equal(res.body.url, undefined);
    assert.deepEqual(calls, [["expire", "checkout"]]);
});

test("a late completed checkout for a deleted account cancels billing without activating the account", async () => {
    const { routes, calls } = billingFixture(); const res = response();
    await routes["/webhook/stripe"]({ headers: {}, body: { type: "checkout.session.completed", data: { object: { client_reference_id: "closing", subscription: "subscription" } } } }, res);
    assert.equal(res.code, 200); assert.equal(res.body.received, true);
    assert.equal(calls.length, 1); assert.equal(calls[0][0], "cancel");
    assert.equal(calls[0][2].invoice_now, false); assert.equal(calls[0][2].prorate, false);
});
