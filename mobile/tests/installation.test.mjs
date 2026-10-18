import test from "node:test";
import assert from "node:assert/strict";
import { installationSnippet } from "../lib/installation.ts";

test("installation uses the account origin and the requested website key", () => {
  const code = installationSnippet("https://tracetray.com/app/", "tt_second");
  assert.match(code, /endpoint: "https:\/\/tracetray.com\/collect", key: "tt_second"/);
  assert.match(code, /src="https:\/\/tracetray.com\/client\/tracker.js"/);
  assert.doesNotMatch(code, /app\//);
  assert.match(installationSnippet("http://localhost:5000/app/", "tt_local"), /localhost:5000\/collect/);
  assert.doesNotMatch(installationSnippet("https://tracetray.com/app/", '</script>"'), /key: "<\/script>/);
});
