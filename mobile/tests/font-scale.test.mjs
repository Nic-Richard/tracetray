import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { handleFontScale } = createRequire(import.meta.url)("../plugins/font-scale.cjs");
const manifest = () => ({
  manifest: { application: [{ activity: [{ $: { "android:name": ".MainActivity", "android:configChanges": "orientation|screenSize" },
    "intent-filter": [{ action: [{ $: { "android:name": "android.intent.action.MAIN" } }], category: [{ $: { "android:name": "android.intent.category.LAUNCHER" } }] }] }] }] }
});

test("Android keeps the activity when the system text size changes, and prebuild stays idempotent", () => {
  const once = handleFontScale(manifest());
  const value = once.manifest.application[0].activity[0].$["android:configChanges"];
  assert.equal(value, "orientation|screenSize|fontScale|density");
  assert.equal(handleFontScale(once).manifest.application[0].activity[0].$["android:configChanges"], value);
});
