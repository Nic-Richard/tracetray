const assert = require("node:assert/strict");
const { test } = require("node:test");
const { groupPage, groupPath, isGroup, parseRule, suggestRules } = require("../src/lib/pageGroups");

test("ids in paths are grouped automatically and ordinary words are not", () => {
    assert.equal(groupPath("/orders/48213"), "/orders/:id");
    assert.equal(groupPath("/lounge/6f1c00000000000000000a3b"), "/lounge/:id");
    assert.equal(groupPath("/p/3f2a9c1e-55b1-4c7e-9a0d-2b8e1c4d5f60/reviews"), "/p/:id/reviews");
    assert.equal(groupPath("/items/V1StGXR8Z5jdHi6B"), "/items/:id");
    assert.equal(groupPath("/blog/introducing-portlore"), "/blog/introducing-portlore");
    assert.equal(groupPath("/users/collector12"), "/users/collector12");
    assert.equal(groupPath("/shop/iphone15pro"), "/shop/iphone15pro");
    assert.equal(groupPath("/"), "/");
});

test("rules group matching pages and the most specific rule wins", () => {
    const rules = ["/sets/:set", "/sets/new", "/sets/:set/cards/:card"];
    assert.equal(groupPath("/sets/rubber-ducks", rules), "/sets/:set");
    assert.equal(groupPath("/sets/new", ["/sets/:set", "/sets/new/:x"]), "/sets/:set");
    assert.equal(groupPath("/sets/rubber-ducks/cards/7", rules), "/sets/:set/cards/:card");
    assert.equal(groupPath("/users/nic", rules), "/users/nic");
    const { page, path } = groupPage("https://miscellary.com/sets/rubber-ducks", rules);
    assert.deepEqual([page, path], ["https://miscellary.com/sets/:set", "/sets/rubber-ducks"]);
    assert.equal(isGroup(page), true);
    assert.equal(isGroup("https://miscellary.com/sets"), false);
});

test("bad rules are rejected", () => {
    for (const bad of ["sets/:set", "/sets", "/", "/:a b", "/sets/*", "x".repeat(400)]) assert.equal(parseRule(bad), null, bad);
    assert.equal(parseRule("/users/:username").pattern, "/users/:username");
});

test("suggestions find patterns with many pages, including nested ones", () => {
    const paths = ["/", "/sets", "/packs", "/sets/new"];
    for (let i = 0; i < 60; i++) paths.push(`/sets/set-${String.fromCharCode(97 + (i % 26))}${i}`);
    for (let i = 0; i < 30; i++) paths.push(`/users/collector-${i}`);
    for (let i = 0; i < 90; i++) paths.push(`/sets/set-x${i % 30}/cards/${i}`);
    for (let i = 0; i < 25; i++) paths.push(`/lounge/6f1c${String(i).padStart(20, "0")}`);
    for (let i = 0; i < 5; i++) paths.push(`/about/team-${i}`);
    for (let i = 0; i < 12; i++) paths.push(`/blog/post-number-${String.fromCharCode(97 + i)}`);
    const found = suggestRules(paths).map(s => s.pattern);
    assert.ok(found.includes("/sets/:set"));
    assert.ok(found.includes("/users/:user"));
    assert.ok(found.includes("/sets/:set/cards/:id"));
    assert.ok(!found.some(p => p.startsWith("/lounge")), "ids are already grouped automatically");
    assert.ok(!found.some(p => p.startsWith("/about")), "too few pages to suggest");
    assert.ok(found.includes("/blog/:blog"), "ten or more pages are enough");
    assert.ok(!suggestRules(paths, ["/sets/:set"]).some(s => s.pattern === "/sets/:set"));
});
