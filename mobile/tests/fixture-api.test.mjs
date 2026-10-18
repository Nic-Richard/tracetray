import test from "node:test";
import assert from "node:assert/strict";
import { createFixtureApi } from "../scripts/fixture-api.mjs";

test("change-note fixtures enforce ownership, recover failed writes and never forward mutations", async () => {
  const calls = [];
  const server = createFixtureApi(async (url, init) => {
    calls.push([url, init.method]);
    if (!url.endsWith("/api/account")) throw new Error("Only account reads may reach upstream");
    return Response.json({ sites: [{ key: "owned" }], site_key: "owned" });
  }, { comparisonMode: "retry" });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const path = "/api/page-changes?site_key=owned&page=https%3A%2F%2Fexample.com%2F";
  const post = body => fetch(origin + path, { method: "POST", body: JSON.stringify(body) });
  try {
    await fetch(origin + "/api/account", { method: "POST" });
    assert.equal((await fetch(origin + "/api/page-changes?site_key=other&page=/")).status, 403);
    const list = await (await fetch(origin + path)).json(); assert.equal(list.length, 2);
    assert.equal((await post({ page: "/", day: "2026-02-30" })).status, 400);
    const day = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
    const body = { page: "https://example.com/", day, note: "Fixture retry note" };
    assert.equal((await post(body)).status, 503);
    const saved = await (await post(body)).json(); assert.equal(saved.note, body.note);
    const compare = origin + `/api/compare?site_key=owned&page=/&day=${day}`;
    assert.equal((await fetch(compare)).status, 503);
    assert.equal((await (await fetch(compare)).json()).goal.verdict, "better");
    assert.equal((await fetch(origin + `/api/page-changes/${saved.id}?site_key=other`, { method: "DELETE" })).status, 403);
    assert.equal((await fetch(origin + `/api/page-changes/${saved.id}?site_key=owned`, { method: "DELETE" })).status, 200);
    assert.equal((await (await fetch(origin + path)).json()).length, 2);
    assert.equal(calls.length, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("account deletion stays in memory, retries failed requests and blocks account reopening", async () => {
  const server = createFixtureApi(() => { throw new Error("Deletion must never reach upstream"); }, { deletionMode: "retry" });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const remove = confirmation => fetch(`${origin}/api/account-deletion`, { method: "POST", body: JSON.stringify({ confirmation, user_id: "other-user" }) });
  try {
    assert.equal((await (await fetch(`${origin}/api/account-deletion`)).json()).state, "none");
    assert.equal((await remove("delete")).status, 400);
    assert.equal((await remove("DELETE")).status, 503);
    assert.equal((await (await fetch(`${origin}/api/account-deletion`)).json()).state, "none");
    assert.equal((await remove("DELETE")).status, 202);
    assert.equal((await (await fetch(`${origin}/api/account-deletion`)).json()).state, "pending");
    const blocked = await fetch(`${origin}/api/account`, { method: "POST" });
    assert.equal(blocked.status, 410);
    assert.equal((await blocked.json()).account_deleting, true);
    assert.equal((await remove("DELETE")).status, 202);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("email preference fixtures retain failed saves and keep changes out of the real account", async () => {
  const server = createFixtureApi(() => { throw new Error("Email preferences must not reach upstream"); }, { emailMode: "retry" });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const read = async () => (await fetch(`${origin}/api/email-prefs`)).json();
  const change = body => fetch(`${origin}/api/email-prefs`, { method: "PATCH", body: JSON.stringify(body) });
  try {
    assert.equal((await read()).weekly_summary, false);
    assert.equal((await change({ weekly_summary: "yes" })).status, 400);
    assert.equal((await change({ weekly_summary: true })).status, 503);
    assert.equal((await read()).weekly_summary, false);
    assert.equal((await change({ weekly_summary: true })).status, 200);
    assert.equal((await read()).weekly_summary, true);
    assert.equal((await read()).shift_alerts, false);
    assert.equal((await change({ weekly_summary: false, shift_alerts: true })).status, 200);
    assert.equal((await read()).weekly_summary, false);
    assert.equal((await read()).shift_alerts, true);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("email preference fixtures cover unavailable plans and an initial read failure", async () => {
  for (const emailMode of ["limited", "read-error"]) {
    const server = createFixtureApi(() => { throw new Error("Email preferences must not reach upstream"); }, { emailMode });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
      const first = await fetch(`${origin}/api/email-prefs`);
      if (emailMode === "read-error") {
        assert.equal(first.status, 503);
        assert.equal((await fetch(`${origin}/api/email-prefs`)).status, 200);
      } else {
        assert.equal((await first.json()).available.shift_alerts, false);
        assert.equal((await fetch(`${origin}/api/email-prefs`, { method: "PATCH", body: '{"shift_alerts":true}' })).status, 403);
        assert.deepEqual((await (await fetch(`${origin}/__fixtures`)).json()).emailChanges, []);
      }
    } finally { await new Promise(resolve => server.close(resolve)); }
  }
});

test("fixture startup delay holds configuration while other reads stay available", async () => {
  const calls = [];
  const server = createFixtureApi(async url => { calls.push(url); return Response.json({ ready: true }); }, { configDelayMs: 250 });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    let resolved = false;
    const config = fetch(`${origin}/api/config`).then(response => { resolved = true; return response.json(); });
    assert.equal((await fetch(`${origin}/api/sites`)).status, 200);
    assert.equal(resolved, false);
    assert.deepEqual(await config, { ready: true });
    assert.ok(calls.every(url => url.startsWith("http://127.0.0.1:5000/api/")));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("fixture Ask, reports and forbidden writes never reach the real API", async () => {
  const forwarded = [];
  const server = createFixtureApi(async url => { forwarded.push(url); return new Response('{"publishableKey":"fixture"}', { headers: { "Content-Type": "application/json" } }); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const ask = question => fetch(`${origin}/api/ask?site_key=owned`, { method: "POST", body: JSON.stringify({ question, history: [] }) });
    const answer = await ask("Where do visitors leave?");
    assert.equal(answer.status, 200);
    assert.match((await answer.json()).answer, /120 visits/);
    assert.equal((await ask("Fixture limit")).status, 403);
    assert.equal((await ask("Fixture retry")).status, 503);
    assert.equal((await ask("Fixture retry")).status, 200);
    const report = await fetch(`${origin}/api/bug-reports?site_key=owned`, { method: "POST", body: JSON.stringify({ category: "bug", description: "The page did not load." }) });
    assert.equal(report.status, 201);
    assert.equal((await report.json()).id, "fixture-report");
    for (const path of ["/api/run-analysis", "/api/analysis-permit", "/api/create-checkout-session", "/api/sites"]) {
      assert.equal((await fetch(`${origin}${path}`, { method: "POST", body: "{}" })).status, path === "/api/sites" ? 409 : 503);
    }
    assert.deepEqual(forwarded, []);
    assert.equal((await fetch(`${origin}/api/config`)).status, 200);
    assert.deepEqual(forwarded, ["http://127.0.0.1:5000/api/config"]);
    const observed = await (await fetch(`${origin}/__fixtures`)).json();
    assert.equal(observed.questions.length, 4);
    assert.equal(observed.questions[0].site, "owned");
    assert.equal(observed.reports[0].site, "owned");
    assert.equal(observed.reports[0].description, "The page did not load.");
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("goal fixtures preserve match/scope, enforce plans and remove main selections without upstream writes", async () => {
  const forwarded = [];
  const server = createFixtureApi(async (url, options) => {
    forwarded.push({ url, method: options.method });
    return Response.json(url.includes("/api/account") ? { sites: [{ key: "owned", name: "Original" }] } : { goals: [], main_goals: [], cap: 20, form_goals: false });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = (path, method = "GET", body) => fetch(`${origin}${path}${path.includes("?") ? "&" : "?"}site_key=owned`, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    await fetch(`${origin}/api/account`, { method: "POST" });
    assert.equal((await fetch(`${origin}/api/goals?site_key=unowned`)).status, 403);
    assert.equal((await call("/api/goals")).status, 200);
    assert.equal((await call("/api/goals", "POST", { name: "Form", type: "form", match: { name: "newsletter" } })).status, 403);
    assert.equal((await call("/api/goals", "POST", { name: "Invalid", type: "click", match: { text: "Buy" }, target: 0 })).status, 400);
    const input = { name: "Fixture retry goal", type: "click", match: { text: "Buy" }, pages: ["https://example.com/"], target: 0.05 };
    assert.equal((await call("/api/goals", "POST", input)).status, 503);
    const added = await (await call("/api/goals", "POST", input)).json();
    assert.equal(added.backfill, "queued");
    const edited = await (await call(`/api/goals/${added.id}`, "PATCH", { name: "Renamed", target: null })).json();
    assert.equal(edited.target, null);
    assert.deepEqual(edited.match, added.match);
    assert.deepEqual(edited.pages, input.pages);
    assert.equal((await call("/api/main-goal", "PUT", { page: input.pages[0], goal: "missing" })).status, 404);
    await call("/api/main-goal", "PUT", { page: input.pages[0], goal: added.id });
    const pageGoal = { name: "Checkout", type: "page", match: { page: "https://example.com/thanks" } };
    assert.equal((await call("/api/goals", "POST", pageGoal)).status, 201);
    assert.equal((await call("/api/goals", "POST", pageGoal)).status, 400);
    await call(`/api/goals/${added.id}`, "DELETE");
    const list = await (await call("/api/goals")).json();
    assert.equal(list.goals.length, 1);
    assert.deepEqual(list.main_goals, []);
    assert.deepEqual(forwarded.map(value => value.method), ["POST", "GET"]);
    assert.ok(forwarded[0].url.endsWith("/api/account"));
    assert.ok(forwarded[1].url.includes("/api/goals?site_key=owned"));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("website fixtures support retry, limits, ownership and last-site replacement without real writes", async () => {
  const forwarded = [];
  const initial = [{ key: "owned", name: "Original", url: null, domain: null }];
  const server = createFixtureApi(async (url, options) => {
    forwarded.push({ url, method: options.method });
    return Response.json({ sites: initial, site_limit: 50, dashboard: "http://localhost:5000/app/" });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const change = (method, suffix = "", name) => fetch(`${origin}/api/sites${suffix}`, { method, ...(name ? { body: JSON.stringify({ name }) } : {}) });
  try {
    await fetch(`${origin}/api/account`, { method: "POST" });
    assert.equal((await change("PATCH", "/unowned", "No")).status, 404);
    assert.equal((await change("POST", "", "Fixture retry website")).status, 503);
    const created = await (await change("POST", "", "Fixture retry website")).json();
    assert.equal(created.sites.length, 2);
    assert.equal((await change("POST", "", "Over the limit")).status, 400);
    const renamed = await (await change("PATCH", `/${created.site.key}`, "Renamed")).json();
    assert.equal(renamed.site.name, "Renamed");
    assert.equal((await (await change("DELETE", `/${created.site.key}`)).json()).reset, false);
    const removed = await (await change("DELETE", "/owned")).json();
    assert.equal(removed.reset, true);
    assert.equal(removed.sites.length, 1);
    assert.notEqual(removed.sites[0].key, "owned");
    assert.equal(removed.sites[0].name, "My website");
    const account = await (await fetch(`${origin}/api/account`, { method: "POST" })).json();
    assert.deepEqual(account.sites, removed.sites);
    assert.equal(account.site_limit, 2);
    assert.deepEqual(forwarded.map(value => value.method), ["POST", "POST"]);
    assert.ok(forwarded.every(value => value.url.endsWith("/api/account")));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
