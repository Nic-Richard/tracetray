import test from "node:test";
import assert from "node:assert/strict";
import { createFixtureApi } from "../scripts/fixture-api.mjs";

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
