import test from "node:test";
import assert from "node:assert/strict";
import { createFixtureApi } from "../scripts/fixture-api.mjs";

test("fixture Ask and forbidden writes never reach the real API", async () => {
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
    for (const path of ["/api/run-analysis", "/api/analysis-permit", "/api/create-checkout-session", "/api/sites"]) {
      assert.equal((await fetch(`${origin}${path}`, { method: "POST", body: "{}" })).status, 503);
    }
    assert.deepEqual(forwarded, []);
    assert.equal((await fetch(`${origin}/api/config`)).status, 200);
    assert.deepEqual(forwarded, ["http://127.0.0.1:5000/api/config"]);
    const observed = await (await fetch(`${origin}/__fixtures`)).json();
    assert.equal(observed.questions.length, 4);
    assert.equal(observed.questions[0].site, "owned");
  } finally { await new Promise(resolve => server.close(resolve)); }
});
