const assert = require("node:assert/strict");
const { test } = require("node:test");
const { sectionTimes, rageIn, deviceAttention } = require("../src/lib/sectionAttention");
const { patternsFor, leversFor, sourceOf } = require("../src/lib/goalPatterns");

const sections = [{ name: "Top", top: 0, bottom: 800 }, { name: "Reviews", top: 800, bottom: 1600 }, { name: "More", top: 1600, bottom: 2400 }];
const geometry = { pageHeight: 2400, viewport: 800 };
const visit = (scrolls, end = 30000) => ({ start_time: 0, end_time: end, events: [{ type: "page_load", page_height: 2400, viewport_height: 800, timestamp: 0 },
    ...scrolls.map(([t, to]) => ({ type: "scroll", to, timestamp: t }))] });

test("sections count time in view, and coming back needs a real stay", () => {
    const passing = sectionTimes(visit([[5000, 800], [15000, 0], [15500, 1600]], 20000), geometry, sections, 1);
    assert.deepEqual(passing.seen, [true, true, true]);
    assert.equal(passing.ms[0], 5500);
    assert.equal(passing.returned[0], false);
    const back = sectionTimes(visit([[5000, 800], [15000, 0]], 20000), geometry, sections, 1);
    assert.equal(back.returned[0], true);
    assert.equal(back.ms[1], 10000);
});

test("rage clicks are three quick clicks in one spot", () => {
    const at = (t, x = 100) => ({ x, py: 200, timestamp: t });
    assert.equal(rageIn([at(0), at(200), at(450)]), true);
    assert.equal(rageIn([at(0), at(700), at(1500)]), false);
    assert.equal(rageIn([at(0), at(200, 300), at(450)]), false);
});

test("clicks on a picture that does nothing are named after it", () => {
    const shot = { page_height: 2400, layout: { sections, elements: [], media: [{ name: "Ridgeline 40 Pack", top: 100, height: 400, left: 0, width: 500 }] } };
    const sessions = Array.from({ length: 40 }, (_, i) => ({ ...visit([[3000, 800]]), events: [...visit([[3000, 800]]).events, ...(i < 8 ? [{ type: "click", target: null, x: 200, py: 300, timestamp: 1000 }] : [])] }));
    const result = deviceAttention(sessions, shot, null);
    assert.equal(result.dead[0].name, "Ridgeline 40 Pack");
    assert.equal(result.dead[0].share, 0.2);
    assert.match(result.callouts[0], /20% of visits clicked the picture “Ridgeline 40 Pack”/);
});

test("sources read as places, and links within the site as pages", () => {
    assert.equal(sourceOf("https://www.google.com/", "https://shop.example"), "Came from Google");
    assert.equal(sourceOf("https://shop.example/collections/packs", "https://shop.example"), "Came from a collection page");
    assert.equal(sourceOf("", "https://shop.example"), "Came straight to the page, with no referrer");
});

test("goal patterns leave out the goal's own button and the approach to it", () => {
    const goal = { id: "cart", name: "Added to cart", type: "click", match: { text: "Add to cart" } };
    const layout = { height: 2400, sections, elements: [{ tag: "BUTTON", text: "Add to cart", top: 400 }, { tag: "A", text: "Other pack", href: "/products/other", top: 1700 }], media: [] };
    const sessions = Array.from({ length: 200 }, (_, i) => {
        const buys = i % 2 === 0, browses = i % 4 === 1;
        const events = [{ type: "page_load", page_height: 2400, viewport_height: 800, timestamp: 0 }, { type: "scroll", to: 1600, timestamp: 4000 }];
        if (browses) events.push({ type: "click", tag: "A", target: { tag: "A", text: "Other pack", href: "/products/other" }, timestamp: 9000 });
        if (buys) events.push({ type: "scroll", to: 0, timestamp: 9000 }, { type: "click", target: { tag: "BUTTON", text: "Add to cart" }, timestamp: 12000 });
        return { start_time: 0, end_time: 20000, referrer: "", page_path: "/products/this", events, goal_hits: buys ? ["cart"] : [] };
    });
    const { patterns } = patternsFor(sessions, goal, layout, "https://shop.example");
    assert.ok(patterns.some(p => p.fact === "Left through a link in “More”" && p.with.reached === 0));
    assert.ok(!patterns.some(p => p.fact.includes("“Top”")));
    assert.ok(!patterns.some(p => p.fact.startsWith("Came back to")));
});

test("an attention goal's patterns leave out how far and how long people read, which would only restate it", () => {
    const goal = { id: "read", name: "Read to the end", type: "attention", match: { kind: "end", seconds: 15, depth: 0.8 } };
    const layout = { height: 2400, sections, elements: [], media: [] };
    const sessions = Array.from({ length: 200 }, (_, i) => {
        const reads = i % 2 === 0, fromSearch = i % 4 === 0;
        const events = [{ type: "page_load", page_height: 2400, viewport_height: 800, timestamp: 0 }, { type: "scroll", to: reads ? 1600 : 400, timestamp: 4000 }];
        return { start_time: 0, end_time: 20000, referrer: fromSearch ? "https://www.google.com/" : "", page_path: "/blog/a", events, goal_hits: reads ? ["read"] : [] };
    });
    const { patterns } = patternsFor(sessions, goal, layout, "https://shop.example");
    assert.ok(patterns.some(p => p.fact.startsWith("Came from")));
    assert.ok(!patterns.some(p => /Scrolled down to|on screen for|Came back to/.test(p.fact)));
});

test("a group's lever is the fact tied to its goal rate, and a group without one gets none", () => {
    const goal = { id: "cart", name: "Added to cart", type: "click", match: { text: "Add to cart" } };
    const layout = { height: 2400, sections, elements: [{ tag: "BUTTON", text: "Add to cart", top: 400 }, { tag: "BUTTON", text: "Size guide", top: 900 }], media: [] };
    const groups = {};
    const sessions = Array.from({ length: 400 }, (_, i) => {
        const group = i < 200 ? 0 : 1, guide = i % 2 === 0;
        const buys = group === 0 ? (guide ? i % 10 < 6 : i % 10 < 2) : i % 3 === 0;
        groups[`v${i}`] = group;
        const events = [{ type: "page_load", page_height: 2400, viewport_height: 800, timestamp: 0 }];
        if (guide) events.push({ type: "click", target: { tag: "BUTTON", text: "Size guide" }, timestamp: 3000 });
        // Lengths vary the same way for buyers and others, so length doesn't explain the gap.
        const end = 6000 + (i * 7919) % 15000;
        if (buys) events.push({ type: "click", target: { tag: "BUTTON", text: "Add to cart" }, timestamp: end - 500 });
        return { session_id: `v${i}`, start_time: 0, end_time: end, referrer: "", page_path: "/products/this", events, goal_hits: buys ? ["cart"] : [] };
    });
    const levers = leversFor(sessions, groups, goal, layout, "https://shop.example");
    assert.equal(levers[0].fact, "Clicked “Size guide”");
    assert.ok(levers[0].with.reached / levers[0].with.visits > levers[0].without.reached / levers[0].without.visits);
    assert.equal(levers[1], undefined);
});
