import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { retainIntent } = createRequire(import.meta.url)("../plugins/retain-intent.cjs");
const activity = `package com.tracetray.app
import android.os.Bundle
class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
  }
}
`;

test("Android retains the newest intent before forwarding it and prebuild stays idempotent", () => {
  const result = retainIntent(activity.replace(/\n/g, "\r\n"));
  assert.match(result, /import android.content.Intent/);
  assert.match(result, /override fun onNewIntent\(intent: Intent\) \{\s+setIntent\(intent\)\s+super.onNewIntent\(intent\)/);
  assert.equal(retainIntent(result), result);
  assert.equal(result.match(/import android.content.Intent/g).length, 1);
  assert.match(result, /super.onCreate\(null\)/);
});

test("Android plugin refuses to overwrite another intent handler or an unfamiliar template", () => {
  assert.throws(() => retainIntent(activity.replace("  override fun onCreate(", "  override fun onNewIntent(intent: Intent) {}\n  override fun onCreate(")), /Review the existing/);
  assert.throws(() => retainIntent("class MainActivity {}"), /template has changed/);
});
