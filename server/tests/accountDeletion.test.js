const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createAccountDeletion, closeBilling, deletionStatus, SETTLE_MS } = require("../src/lib/accountDeletion");

function fixture(options = {}) {
    const calls = [];
    const now = new Date("2026-10-18T12:00:00Z");
    let account = { _id: "account-1", clerk_user_id: "user-1", site_key: "site-1", sites: [{ key: "site-1" }, { key: "site-2" }], deletion_requested_at: new Date(+now - SETTLE_MS), ...options.account };
    let job = { _id: "request-1", clerk_user_id: "user-1", references: ["user-1", "site-1"], state: "pending", requested_at: now };
    const running = {};
    const deps = {
        Account: {
            findOne: filter => ({ lean: async () => { calls.push(["lookup", filter]); return account; } }),
            updateOne: async (filter, update) => { calls.push(["mark", filter]); Object.assign(account, update.$set); },
            deleteOne: async filter => { calls.push(["account", filter]); account = null; }
        },
        AccountDeletion: {
            findOneAndUpdate: async (filter, update) => { calls.push(["request", filter, update]); return job; },
            updateOne: async (filter, update) => { calls.push(["complete", filter, update]); Object.assign(job, update.$set); }
        },
        BugReport: { deleteMany: async filter => calls.push(["reports", filter]) },
        clerk: { users: { deleteUser: async id => { calls.push(["clerk", id]); if (options.clerkError) throw options.clerkError; } } },
        stripe: null,
        getSites: value => value.sites,
        deleteSiteData: async key => { calls.push(["site", key]); if (options.siteError) throw new Error("disk unavailable"); },
        analysisRunning: running,
        shotsPending: () => !!options.shotsPending,
        collectionPending: () => !!options.collectionPending
    };
    return { service: createAccountDeletion(deps), calls, now, job, account, running };
}

test("deletion requires an exact confirmation before touching account data", async () => {
    const f = fixture();
    for (const value of [undefined, "delete", "DELETE ", true]) assert.equal((await f.service.request("user-1", value)).status, 400);
    assert.deepEqual(f.calls, []);
});

test("requests use the authenticated identity and persist a retryable receipt", async () => {
    const f = fixture();
    const response = await f.service.request("user-1", "DELETE", f.now);
    assert.equal(response.status, 202);
    assert.equal(response.body.state, "pending");
    const request = f.calls.find(call => call[0] === "request");
    assert.deepEqual(request[1], { clerk_user_id: "user-1" });
    assert.deepEqual(request[2].$setOnInsert.references, ["user-1", "site-1"]);
    assert.deepEqual(f.calls.find(call => call[0] === "mark")[1], { _id: "account-1", deletion_requested_at: null });
    await f.service.request("user-1", "DELETE", f.now);
    assert.equal(f.job.state, "pending");
});

test("cleanup waits for collection caches, running analyses and queued screenshots", async () => {
    for (const options of [{ account: { deletion_requested_at: null } }, { account: { deletion_requested_at: new Date("2026-10-18T12:00:00Z") } }, { shotsPending: true }, { collectionPending: true }]) {
        const f = fixture(options);
        assert.equal(await f.service.process(f.job, f.now), false);
        assert.ok(!f.calls.some(call => ["clerk", "site", "complete"].includes(call[0])));
    }
    const f = fixture(); f.running["site-2"] = true;
    assert.equal(await f.service.process(f.job, f.now), false);
});

test("cleanup scopes every site and report, then removes identity and account", async () => {
    const f = fixture();
    assert.equal(await f.service.process(f.job, f.now), true);
    assert.deepEqual(f.calls.filter(call => call[0] === "site"), [["site", "site-1"], ["site", "site-2"]]);
    assert.deepEqual(f.calls.find(call => call[0] === "reports")[1], { account_id: "account-1" });
    assert.deepEqual(f.calls.find(call => call[0] === "clerk"), ["clerk", "user-1"]);
    assert.ok(f.calls.findIndex(call => call[0] === "account") > f.calls.findIndex(call => call[0] === "clerk"));
    assert.equal(f.job.state, "complete");
    assert.equal(+f.job.expires_at - +f.now, 30 * 86400000);
});

test("provider or file failures preserve the account and leave the job retryable", async () => {
    for (const options of [{ clerkError: { status: 503 } }, { siteError: true }, { account: { stripe_customer_id: "cus-1" } }]) {
        const f = fixture(options);
        await assert.rejects(f.service.process(f.job, f.now));
        assert.ok(!f.calls.some(call => call[0] === "account" || call[0] === "complete"));
    }
});

test("a previously removed Clerk identity does not block a retry", async () => {
    const f = fixture({ clerkError: { status: 404 } });
    assert.equal(await f.service.process(f.job, f.now), true);
    assert.deepEqual(deletionStatus(null), { state: "none" });
});

test("billing expires only matching checkouts and cancels only live customer subscriptions", async () => {
    const calls = [];
    const stripe = {
        checkout: { sessions: {
            list: async function* () { yield { id: "cs-other", client_reference_id: "other" }; yield { id: "cs-own", client_reference_id: "user-1" }; },
            expire: async id => calls.push(["expire", id])
        } },
        subscriptions: {
            list: async function* (filter) {
                calls.push(["filter", filter]);
                yield { id: "other-app", status: "active", items: { data: [{ price: { lookup_key: "other-app" } }] } };
                for (const status of ["trialing", "active", "past_due", "canceled", "incomplete_expired"]) yield { id: status, status, items: { data: [{ price: { lookup_key: "tracetray_pro_monthly" } }] } };
            },
            cancel: async (id, options) => calls.push(["cancel", id, options])
        }
    };
    await closeBilling(stripe, ["user-1"], "cus-1");
    assert.deepEqual(calls.filter(call => call[0] === "expire"), [["expire", "cs-own"]]);
    assert.equal(calls.find(call => call[0] === "filter")[1].customer, "cus-1");
    assert.deepEqual(calls.filter(call => call[0] === "cancel").map(call => call[1]), ["trialing", "active", "past_due"]);
    for (const call of calls.filter(call => call[0] === "cancel")) assert.deepEqual(call[2], { invoice_now: false, prorate: false });
});
