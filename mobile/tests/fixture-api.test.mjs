import test from "node:test";
import assert from "node:assert/strict";
import { createFixtureApi } from "../scripts/fixture-api.mjs";

test("analysis and history fixtures enforce ownership and permits without forwarding writes", async () => {
  const calls = [];
  const server = createFixtureApi(async (url, init) => {
    calls.push([url, init.method]);
    if (url.endsWith("/api/account")) return Response.json({ sites: [{ key: "owned" }, { key: "second" }] });
    if (url.includes("/api/stats")) return Response.json({ total_sessions: 100, last_analysis: { site_key: "owned", page: "/a", ran_at: "2026-01-01", clusters: [] } });
    if (url.includes("/api/pages")) return Response.json([{ page: "/a" }, { page: "/b" }]);
    throw Error("Unexpected upstream request");
  }, { analysisMode: "normal" });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(origin + path, { method: "POST", body: JSON.stringify(body) });
  try {
    await post("/api/account", {});
    assert.equal((await post("/api/analysis-permit?site_key=other", { scope: "page", page_count: 1 })).status, 403);
    await fetch(origin + "/api/stats?site_key=owned&page=/a");
    const permit = await (await post("/api/analysis-permit?site_key=owned", { scope: "page", page_count: 1 })).json();
    assert.equal((await post("/api/run-analysis", { site_key: "second", page: "/a", permit_token: permit.permit_token })).status, 403);
    const run = await (await post("/api/run-analysis", { site_key: "owned", page: "/a", permit_token: permit.permit_token })).json();
    assert.notEqual(run.result.ran_at, "2026-01-01");
    assert.equal((await post("/api/run-analysis", { site_key: "owned", page: "/a", permit_token: permit.permit_token })).status, 403);
    assert.equal((await post("/api/pages/reset?site_key=other", { page: "/a" })).status, 403);
    assert.equal((await (await post("/api/pages/reset?site_key=owned", { page: "/a" })).json()).deleted_sessions, 100);
    const stats = await (await fetch(origin + "/api/stats?site_key=owned&page=/a")).json();
    assert.equal(stats.total_sessions, 0); assert.equal(stats.last_analysis, null);
    assert.equal((await (await fetch(origin + "/api/sessions/timeseries?site_key=owned&page=/a")).json()).total_sessions, 0);
    assert.deepEqual(await (await fetch(origin + "/api/pages?site_key=owned")).json(), [{ page: "/b" }]);
    assert.deepEqual(calls.map(([, method]) => method), ["POST", "GET", "GET"]);
    await post("/api/account-deletion", { confirmation: "DELETE" });
    assert.equal((await fetch(origin + "/api/stats?site_key=owned&page=/a")).status, 410);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("analytics previews forward reads and image bytes while keeping mutations blocked", async () => {
  const calls = [];
  const paths = ["/api/ux-trends", "/api/goal-trend", "/api/attention-profile", "/api/page-shot", "/api/sessions/recent"];
  const server = createFixtureApi(async (url, init) => {
    calls.push([url, init.method]);
    return url.includes("/api/page-shot") ? new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "Content-Type": "image/png" } }) : Response.json({ ok: true });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of paths) {
      const response = await fetch(`${origin}${path}?site_key=owned`);
      assert.equal(response.status, 200);
      if (path === "/api/page-shot") {
        assert.equal(response.headers.get("Content-Type"), "image/png");
        assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [137, 80, 78, 71]);
      }
      assert.equal((await fetch(origin + path, { method: "POST" })).status, 503);
    }
    assert.equal((await fetch(origin + "/api/run-analysis", { method: "POST" })).status, 503);
    assert.equal(calls.length, paths.length);
    assert(calls.every(([, method]) => method === "GET"));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("path fixtures preserve ordered steps, period counts, retries and site ownership without real writes", async () => {
  const calls = [];
  const server = createFixtureApi(async (url, init) => {
    calls.push([url, init.method]);
    if (!url.endsWith("/api/account")) throw new Error("Only the fixture account may reach upstream");
    return Response.json({ sites: [{ key: "owned" }], site_key: "owned" });
  }, { pathMode: "remove-error" });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const read = days => fetch(`${origin}/api/paths?site_key=owned&days=${days}`).then(value => value.json());
  const post = body => fetch(`${origin}/api/paths?site_key=owned`, { method: "POST", body: JSON.stringify(body) });
  try {
    await fetch(origin + "/api/account", { method: "POST" });
    assert.equal((await fetch(origin + "/api/paths?site_key=other")).status, 403);
    const list = await read(7); assert.equal(list.paths[0].days, 7); assert.equal(list.paths[0].steps[0].all, 100);
    assert.equal((await read(90)).paths[0].steps[0].all, 600);
    const steps = ["https://example.com/cart", "https://example.com/checkout"];
    assert.equal((await post({ name: "Duplicate", steps: [steps[0], steps[0]] })).status, 400);
    const body = { name: "Fixture retry buying", steps };
    assert.equal((await post(body)).status, 503);
    const saved = await (await post(body)).json();
    const path = (await read(30)).paths.find(value => value.id === saved.id);
    assert.deepEqual(path.steps.map(value => value.page), steps);
    assert.equal((await fetch(`${origin}/api/paths/${saved.id}?site_key=other`, { method: "DELETE" })).status, 403);
    assert.equal((await fetch(`${origin}/api/paths/${saved.id}?site_key=owned`, { method: "DELETE" })).status, 503);
    assert.equal((await read(30)).paths.length, 2);
    assert.equal((await fetch(`${origin}/api/paths/${saved.id}?site_key=owned`, { method: "DELETE" })).status, 200);
    assert.equal((await read(30)).paths.length, 1);
    assert.equal(calls.length, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("path fixtures cover empty counts, empty lists, plan restrictions and read recovery", async () => {
  for (const pathMode of ["empty", "zero", "limited", "read-error", "full"]) {
    const server = createFixtureApi(async () => Response.json({ sites: [{ key: "owned" }] }), { pathMode });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
      await fetch(origin + "/api/account", { method: "POST" });
      let response = await fetch(origin + "/api/paths?site_key=owned");
      if (pathMode === "limited") { assert.equal(response.status, 403); continue; }
      if (pathMode === "read-error") { assert.equal(response.status, 503); response = await fetch(origin + "/api/paths?site_key=owned"); }
      const data = await response.json();
      if (pathMode === "empty") assert.deepEqual(data.paths, []);
      if (pathMode === "zero") assert.ok(data.paths[0].steps.every(value => value.all === 0));
      if (pathMode === "full") assert.equal(data.paths.length, data.cap);
      assert.equal(response.status, 200);
    } finally { await new Promise(resolve => server.close(resolve)); }
  }
});

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

test("group fixtures cover pagination, search, sorting, periods, shrinking totals and restricted previews", async () => {
  for (const memberMode of ["paged", "retry", "shrink", "limited", "empty"]) {
    const server = createFixtureApi(async () => Response.json({ sites: [{ key: "owned" }] }), { memberMode });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const read = query => fetch(`${origin}/api/pages/members?site_key=owned&page=/products/:product&${query}`);
    try {
      await fetch(origin + "/api/account", { method: "POST" });
      assert.equal((await fetch(origin + "/api/pages/members?site_key=other")).status, 403);
      let response = await read("limit=25&days=7");
      if (memberMode === "retry") { assert.equal(response.status, 503); response = await read("limit=25&days=7"); }
      const first = await response.json();
      if (memberMode === "empty") { assert.equal(first.total, 0); assert.deepEqual(first.rows, []); continue; }
      if (memberMode === "limited") {
        assert.equal(first.limited, true); assert.equal(first.rows.length, 10);
        assert.deepEqual((await (await read("q=missing&offset=50&days=7")).json()).rows, first.rows); continue;
      }
      assert.equal(first.rows.length, 25); assert.equal(first.rows[0].path, "/products/pack-01");
      const second = await (await read("offset=25&limit=25&days=7")).json();
      assert.equal(second.rows[0].path, "/products/pack-26");
      const last = await (await read("offset=50&limit=25")).json();
      if (memberMode === "shrink") {
        assert.equal(last.total, 26); assert.equal(last.rows.length, 0);
        assert.equal((await (await read("offset=25")).json()).rows.length, 1); continue;
      }
      assert.equal(last.rows.length, 8);
      const filtered = await (await read("q=pack-58&sort=clicks&days=30")).json();
      assert.equal(filtered.total, 1); assert.equal(filtered.rows[0].clicks, 58 * 30);
      assert.equal((await (await read("sort=clicks")).json()).rows[0].path, "/products/pack-58");
      assert.deepEqual((await (await read("q=missing")).json()).rows, []);
    } finally { await new Promise(resolve => server.close(resolve)); }
  }
});

test("goal picker fixtures recover reads, cover empty and restricted lists, and reorder forms without writes", async () => {
  for (const pickerMode of ["empty-pages", "pages-error", "empty-forms", "forms-error", "reordered-forms", "limited"]) {
    const calls = [];
    const server = createFixtureApi(async (url, init) => {
      calls.push([url, init.method]);
      if (url.endsWith("/api/account")) return Response.json({ sites: [{ key: "owned" }] });
      if (url.includes("/api/goals")) return Response.json({ goals: [], main_goals: [], form_goals: true });
      if (url.includes("/api/pages")) return Response.json([{ page: "https://example.com/" }]);
      throw new Error("Unexpected upstream read");
    }, { pickerMode });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const read = path => fetch(`${origin}/api/${path}?site_key=owned`);
    try {
      await fetch(origin + "/api/account", { method: "POST" });
      const goals = await (await read("goals")).json();
      assert.equal(goals.form_goals, pickerMode !== "limited");
      const path = pickerMode.includes("pages") ? "pages" : "forms";
      if (pickerMode === "pages-error") assert.equal((await read(path)).status, 200);
      let response = await read(path);
      if (pickerMode.endsWith("error")) { assert.equal(response.status, 503); response = await read(path); }
      const rows = await response.json();
      if (pickerMode.startsWith("empty")) assert.deepEqual(rows, []);
      else assert.ok(rows.length > 0);
      if (pickerMode === "reordered-forms") assert.deepEqual((await (await read("forms")).json()).map(row => row.id), [...rows].reverse().map(row => row.id));
      assert.equal((await fetch(origin + "/api/forms?site_key=other")).status, 403);
      assert.ok(calls.every(([url, method]) => method === "GET" || url.endsWith("/api/account")));
    } finally { await new Promise(resolve => server.close(resolve)); }
  }
});
