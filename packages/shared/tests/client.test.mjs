import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../src/client.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { createApi } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);

test("follow-up requests carry the finding reference and selected change without sending a claimed snapshot", async () => {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push([new URL(url), init]); return Response.json({}); };
  try {
    const api = createApi({ baseUrl: "https://fixture.example", getToken: async () => "fixture-token" });
    const source = { ran_at: "2026-10-01T12:00:00.000Z", device: "mobile", action: "Try a clearer link?", group: "Steady & slow" };
    await api.changeFinding("owned", "/a?b", source);
    assert.equal(calls[0][0].searchParams.get("group"), source.group);
    assert.equal(calls[0][0].searchParams.get("page"), "/a?b");
    assert.equal(calls[0][0].searchParams.get("site_key"), "owned");
    await api.addPageChange("owned", { page: "/a?b", day: "2026-10-02", note: "Moved link", source });
    const body = JSON.parse(calls[1][1].body);
    assert.deepEqual(body.source, source);
    assert.equal(body.finding, undefined);
    await api.compare("owned", "/a?b", "2026-10-02", "selected-change");
    assert.equal(calls[2][0].searchParams.get("change"), "selected-change");
    assert.equal(calls[2][0].searchParams.get("site_key"), "owned");
  } finally { globalThis.fetch = previous; }
});
