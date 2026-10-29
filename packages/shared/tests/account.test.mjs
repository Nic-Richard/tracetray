import test from "node:test";
import assert from "node:assert/strict";
import { ignoreLinks, reportError, reportPageUrl, usageMeter } from "../src/account.ts";

test("report validation trims descriptions and enforces both API boundaries", () => {
  assert(reportError("  short  "));
  assert.equal(reportError("  1234567890  "), null);
  assert.equal(reportError("x".repeat(5000)), null);
  assert(reportError("x".repeat(5001)));
});

test("report page context excludes credentials, query values and fragments", () => {
  assert.equal(reportPageUrl("https://user:password@example.com/packs?token=private#private"), "https://example.com/packs");
  for (const url of ["javascript:alert(1)", "file:///private", "/packs", "not a URL"]) assert.equal(reportPageUrl(url), "");
});

test("usage distinguishes unlimited, zero and exceeded allowances without invalid shares", () => {
  assert.deepEqual(usageMeter(12, null), { share: null, over: false });
  assert.deepEqual(usageMeter(0, 0), { share: 0, over: false });
  assert.deepEqual(usageMeter(1, 0), { share: 1, over: true });
  assert.deepEqual(usageMeter(4, 10), { share: 0.4, over: false });
  assert.deepEqual(usageMeter(12, 10), { share: 1, over: true });
});

test("opt-out links point at the site's home page and skip unknown or unsafe addresses", () => {
  assert.deepEqual(ignoreLinks({ url: "https://shop.example.com/products?x=1", domain: null }), { ignore: "https://shop.example.com/?tt_ignore=1", count: "https://shop.example.com/?tt_ignore=0" });
  assert.equal(ignoreLinks({ url: null, domain: "example.com" })?.ignore, "https://example.com/?tt_ignore=1");
  for (const site of [{ url: null, domain: null }, { url: "javascript:alert(1)", domain: null }]) assert.equal(ignoreLinks(site), null);
});
