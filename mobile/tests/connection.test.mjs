import assert from "node:assert/strict";
import test from "node:test";
import { resolveApiUrl } from "../lib/connection.ts";

test("development reaches the host from phones and the Android emulator", () => {
  assert.equal(resolveApiUrl(undefined, "192.168.1.7:8081", true), "http://192.168.1.7:5000");
  assert.equal(resolveApiUrl(undefined, undefined, true), "http://10.0.2.2:5000");
  assert.equal(resolveApiUrl(undefined, "[::1]:8081", true), "http://[::1]:5000");
});

test("release defaults to production and refuses insecure or malformed API origins", () => {
  assert.equal(resolveApiUrl(undefined, "192.168.1.7:8081", false), "https://tracetray.com");
  assert.equal(resolveApiUrl(" https://tracetray.com/ ", undefined, false), "https://tracetray.com");
  for (const value of ["http://tracetray.com", "file:///data", "https://user:pass@tracetray.com", "https://tracetray.com/api", "https://tracetray.com?secret=x", "https://tracetray.com#x"]) {
    assert.throws(() => resolveApiUrl(value, undefined, false));
  }
});
