import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bundle = await build({ entryPoints: [fileURLToPath(new URL("../lib/analysisActions.ts", import.meta.url))], bundle: true, platform: "node", format: "esm", write: false });
const { refreshAnalysis } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

test("bulk refresh filters locked and insufficient pages and runs serially with one scoped permit", async () => {
  const calls = [], progress = [];
  let running = false;
  const api = {
    pages: async site => { assert.equal(site, "owned"); return [{ page: "/a", analysable: 16 }, { page: "/locked", analysable: 100, locked: true }, { page: "/small", analysable: 15 }, { page: "/b", analysable: 50 }]; },
    analysisPermit: async (...args) => { calls.push(args); return { permit_token: "permit" }; },
    runAnalysis: async (...args) => { assert.equal(running, false); running = true; calls.push(args); await new Promise(resolve => setTimeout(resolve, 1)); running = false; return { result: {} }; }
  };
  assert.equal(await refreshAnalysis(api, "owned", "/a", "all", value => progress.push(value)), "Refreshed 2 pages.");
  assert.deepEqual(calls, [["owned", "all", 2], ["owned", "permit", "/a"], ["owned", "permit", "/b"]]);
  assert.equal(progress.length, 2);
});

test("empty inventories, quota failures and leaving the screen never start extra analyses", async () => {
  let runs = 0, permits = 0, active = true;
  const api = {
    pages: async () => [],
    analysisPermit: async () => { permits++; throw new Error("Daily limit"); },
    runAnalysis: async () => { runs++; active = false; return { result: {} }; }
  };
  assert.match(await refreshAnalysis(api, "owned", "/a", "all", () => {}), /No page has 16/);
  assert.equal(permits, 0);
  await assert.rejects(refreshAnalysis(api, "owned", "/a", "page", () => {}), /Daily limit/);
  assert.equal(runs, 0);
  api.pages = async () => [{ page: "/a", analysable: 20 }, { page: "/b", analysable: 20 }];
  api.analysisPermit = async () => ({ permit_token: "permit" });
  assert.equal(await refreshAnalysis(api, "owned", "/a", "all", () => {}, () => active), null);
  assert.equal(runs, 1);
});

test("single-page refresh reports server failures and remaining allowance; a failed batch stops", async () => {
  const api = { analysisPermit: async () => ({ permit_token: "permit", remaining_free_today: 2 }), runAnalysis: async () => ({ result: { failure: { message: "Need more visits" } } }) };
  assert.equal(await refreshAnalysis(api, "owned", "/a", "page", () => {}), "Need more visits");
  api.runAnalysis = async () => ({ result: {} });
  assert.match(await refreshAnalysis(api, "owned", "/a", "page", () => {}), /2 more refreshes/);
  api.pages = async () => [{ page: "/a", analysable: 20 }, { page: "/b", analysable: 20 }, { page: "/c", analysable: 20 }];
  const visited = [];
  api.runAnalysis = async (_site, _permit, page) => { visited.push(page); if (page === "/b") throw new Error("Connection lost"); return { result: {} }; };
  await assert.rejects(refreshAnalysis(api, "owned", "/a", "all", () => {}), /Connection lost/);
  assert.deepEqual(visited, ["/a", "/b"]);
});
