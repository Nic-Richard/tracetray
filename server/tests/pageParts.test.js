const assert = require("node:assert/strict");
const { test } = require("node:test");
const { sectionTimes, rageIn, deviceAttention } = require("../src/lib/sectionAttention");
const { patternsFor, sourceOf } = require("../src/lib/goalPatterns");

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
