const assert = require("node:assert/strict");
const { test } = require("node:test");
const { holdAction } = require("../src/jobs/dataHold");

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-11-20T12:00:00Z");
const ended = (extra = {}) => ({ plan: "none", subscription: { status: "canceled" }, delete_after: new Date(now + 10 * DAY), ...extra });

test("nothing happens more than 7 days before the deletion date", () => {
    assert.equal(holdAction(ended(), now), null);
});

test("the notice goes out once the deletion date is 7 days away", () => {
    assert.equal(holdAction(ended({ delete_after: new Date(now + 7 * DAY) }), now), "notice");
    assert.equal(holdAction(ended({ delete_after: new Date(now - DAY) }), now), "notice", "a missed notice is still sent before anything is deleted");
});

test("data is only deleted on the date and a full 7 days after the notice", () => {
    const noticed = ended({ delete_after: new Date(now - DAY), deletion_notice_sent_at: new Date(now - 7 * DAY) });
    assert.equal(holdAction(noticed, now), "delete");
    assert.equal(holdAction({ ...noticed, deletion_notice_sent_at: new Date(now - 2 * DAY) }, now), null, "a late notice still gets its full 7 days");
    assert.equal(holdAction({ ...noticed, delete_after: new Date(now + DAY) }, now), null);
});

test("accounts with a plan, a live subscription or no deletion date are never touched", () => {
    const due = { delete_after: new Date(now - DAY), deletion_notice_sent_at: new Date(now - 8 * DAY) };
    assert.equal(holdAction(ended({ ...due, plan: "pro" }), now), null);
    assert.equal(holdAction(ended({ ...due, subscription: { status: "active" } }), now), null);
    assert.equal(holdAction(ended({ ...due, subscription: { status: "past_due" } }), now), null);
    assert.equal(holdAction(ended({ ...due, subscription: undefined }), now), null);
    assert.equal(holdAction(ended({ delete_after: undefined }), now), null);
});
