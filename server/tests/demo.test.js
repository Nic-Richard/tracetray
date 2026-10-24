const assert = require("node:assert/strict");
const { test } = require("node:test");
const { refuseDemo } = require("../src/lib/demo");

const response = () => ({ code: null, status(code) { this.code = code; return this; }, json() { return this; } });

test("the demo account is refused and normal accounts go through", () => {
    const res = response();
    assert.equal(refuseDemo({ demo: true }, res), true);
    assert.equal(res.code, 403);
    assert.equal(refuseDemo({ plan: "pro" }, response()), false);
    assert.equal(refuseDemo(null, response()), false);
});
