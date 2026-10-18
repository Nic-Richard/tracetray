import assert from "node:assert/strict";
import test from "node:test";
import { redirectSystemPath } from "../app/+native-intent.ts";

test("hosted auth returns stay out of navigation while Clerk finishes sign-in", () => {
  const path = "clerk://com.tracetray.app.hosted-callback?state=test-state&rotating_token_nonce=test-nonce&created_session_id=test-session";
  assert.equal(redirectSystemPath({ path, initial: false }), "");
  assert.equal(redirectSystemPath({ path, initial: true }), "/sign-in");
  assert.equal(redirectSystemPath({ path: "clerk://com.tracetray.app.hosted-callback/", initial: false }), "");
});

test("normal links and other callback hosts keep their original routes", () => {
  for (const path of [
    "tracetray://page?site=owned&page=https%3A%2F%2Fexample.com%2F",
    "/journeys?site=owned",
    "clerk://other.app.hosted-callback?state=test-state",
    "clerk://com.tracetray.app.hosted-callback.evil",
    "clerk://com.tracetray.app.hosted-callback/unrelated",
    "clerk://user@com.tracetray.app.hosted-callback",
    "https://com.tracetray.app.hosted-callback",
    "not a valid URL",
  ]) {
    for (const initial of [true, false]) assert.equal(redirectSystemPath({ path, initial }), path);
  }
});
