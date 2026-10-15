const assert = require("node:assert/strict");
const { test } = require("node:test");
const { interpretClusters, guessPageType } = require("../src/lib/interpretClusters");

const cluster = (id, n, feature_means) => ({ id, n, feature_means });
const significant = (...features) => features.map(feature => ({ feature, significant: "yes" }));

const readerAndScanner = {
    session_count: 120,
    clusters: [
        cluster(0, 70, { pause_rate: 0.9, avg_cursor_velocity: 0.3, click_rate: 0.02, top_zone_ratio: 0.3, scroll_depth_reached: 0.7, spatial_entropy: 1.2 }),
        cluster(1, 50, { pause_rate: 0.2, avg_cursor_velocity: 1.2, click_rate: 0.02, top_zone_ratio: 0.75, scroll_depth_reached: 0.2, spatial_entropy: 1.2 }),
    ],
    kruskal_wallis: significant("pause_rate", "avg_cursor_velocity", "top_zone_ratio", "scroll_depth_reached"),
};

test("clear behaviour gets the matching archetype, with the numbers behind it", () => {
    const result = interpretClusters({ desktop: readerAndScanner, pageUrl: "https://example.com/" });
    assert.equal(result.cluster_stories[0].headline, "Deep readers");
    assert.match(result.cluster_stories[1].headline, /Content skimmers|Header scanners/);
    assert.match(result.cluster_stories[0].body, /^58% of desktop visitors\. They .*pause about 48% more often than average\./);
    assert.equal(result.page_type, "Homepage");
    assert.match(result.site_summary, /^58% of desktop visitors are deep readers\./);
    assert.ok(result.top_suggestions.length >= 1);
});

test("the same data always gets the same names", () => {
    const a = interpretClusters({ desktop: readerAndScanner, pageUrl: "https://example.com/" });
    const b = interpretClusters({ desktop: structuredClone(readerAndScanner), pageUrl: "https://example.com/" });
    assert.deepEqual(a, b);
});

test("a group close to the page average is called typical", () => {
    const result = interpretClusters({ desktop: { session_count: 90, clusters: [
        cluster(0, 30, { pause_rate: 0.5, click_rate: 0.05, move_density: 1 }),
        cluster(1, 30, { pause_rate: 0.51, click_rate: 0.05, move_density: 1.02 }),
        cluster(2, 30, { pause_rate: 0.49, click_rate: 0.05, move_density: 0.98 }),
    ] } });
    assert.ok(Object.values(result.cluster_stories).every(s => s.headline === "Typical visitors"));
});

test("behaviour that fits no archetype gets a name from its strongest traits, and names stay unique", () => {
    const result = interpretClusters({ desktop: { session_count: 100, clusters: [
        cluster(0, 50, { bottom_zone_ratio: 0.7, click_rate: 0.12, scroll_depth_reached: 0.5 }),
        cluster(1, 50, { bottom_zone_ratio: 0.2, click_rate: 0.03, scroll_depth_reached: 0.5 }),
    ] } });
    const names = Object.values(result.cluster_stories).map(s => s.headline);
    assert.equal(names[0], "Click-happy readers");
    assert.equal(new Set(names).size, names.length);
});

test("suggestions depend on the page type", () => {
    const hesitant = { session_count: 80, clusters: [
        cluster(0, 40, { dwell_before_click: 2400, click_rate: 0.01 }),
        cluster(1, 40, { dwell_before_click: 600, click_rate: 0.06 }),
    ] };
    const pricing = interpretClusters({ desktop: hesitant, pageUrl: "https://example.com/pricing" });
    const blog = interpretClusters({ desktop: hesitant, pageUrl: "https://example.com/blog/hello" });
    assert.equal(pricing.cluster_stories[0].headline, "Hesitant browsers");
    assert.match(pricing.cluster_stories[0].suggestions[0], /plan/);
    assert.doesNotMatch(blog.cluster_stories[0].suggestions[0], /plan/);
});

test("mobile groups are named too and devices are compared in plain numbers", () => {
    const mobile = { session_count: 40, clusters: [
        cluster(0, 25, { tap_rate: 0.002, scroll_depth_reached: 0.1, attention_pause_rate: 0.02 }),
        cluster(1, 15, { tap_rate: 0.05, scroll_depth_reached: 0.85, attention_pause_rate: 0.02 }),
    ] };
    const result = interpretClusters({ desktop: readerAndScanner, mobile });
    assert.equal(result.mobile_cluster_stories[0].headline, "Quick exits");
    assert.equal(result.mobile_cluster_stories[1].headline, "Active tappers");
    assert.match(result.device_comparison, /Mobile visitors get \d+% of the way down/);
    assert.match(interpretClusters({ desktop: readerAndScanner }).device_comparison, /isn't enough mobile traffic/);
});

test("first impressions are described from the measured numbers", () => {
    const note = interpretClusters({ desktop: readerAndScanner, firstImpression: { velocity_delta_pct: 48, early_zone_breakdown: { top: 0.7 } } }).first_impression_note;
    assert.match(note, /48% faster/);
    assert.match(note, /70%/);
});

test("odd or missing numbers never leak into the text", () => {
    let seed = 11;
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const features = ["pause_rate", "click_rate", "move_density", "avg_cursor_velocity", "dwell_before_click", "spatial_entropy",
        "top_zone_ratio", "centre_zone_ratio", "bottom_zone_ratio", "scroll_depth_reached", "direction_change_rate"];
    for (let run = 0; run < 200; run++) {
        const clusters = Array.from({ length: 2 + Math.floor(rand() * 4) }, (_, id) => cluster(id, Math.floor(rand() * 60), Object.fromEntries(
            features.filter(() => rand() > 0.2).map(f => [f, rand() < 0.1 ? 0 : rand() * (f === "dwell_before_click" ? 3000 : 1.5)]))));
        const text = JSON.stringify(interpretClusters({ desktop: { session_count: 60, clusters }, pageUrl: "https://example.com/x" }));
        assert.doesNotMatch(text, /NaN|undefined|Infinity|null%/);
    }
});

test("groups that never click aren't described as clicking instantly", () => {
    const result = interpretClusters({ desktop: { session_count: 60, clusters: [
        cluster(0, 30, { dwell_before_click: 40, click_rate: 0, pause_rate: 0.1 }),
        cluster(1, 30, { dwell_before_click: 1500, click_rate: 0.08, pause_rate: 0.6 }),
    ] } });
    assert.doesNotMatch(result.cluster_stories[0].body, /click after about 0\.0 s|100% less/);
});

test("page types are guessed from the address", () => {
    assert.equal(guessPageType("https://example.com/"), "homepage");
    assert.equal(guessPageType("https://example.com/plans"), "pricing");
    assert.equal(guessPageType("https://example.com/docs/setup"), "help");
    assert.equal(guessPageType("https://example.com/about"), "other");
});

test("with a goal, groups that clearly reach it more are called working and the ones falling short lead", () => {
    const withGoal = structuredClone(readerAndScanner);
    withGoal.clusters[0].goal_hits = { g1: 35 };
    withGoal.clusters[1].goal_hits = { g1: 2 };
    const result = interpretClusters({ desktop: withGoal, pageUrl: "https://example.com/", goal: { id: "g1", name: "checkout" } });
    const [readers, scanners] = [result.cluster_stories[0], result.cluster_stories[1]];
    assert.equal(readers.goal.standing, "above");
    assert.match(readers.body, /50% of them reach checkout, against 31% across the page, so what they rely on is working\./);
    assert.deepEqual(readers.suggestions, []);
    assert.equal(scanners.goal.standing, "below");
    assert.match(scanners.body, /Only 4% of them reach checkout/);
    assert.equal(result.top_suggestions[0], scanners.suggestions[0]);
    assert.match(result.site_summary, /^58% of desktop visitors are deep readers\./);
});

test("a goal reached only a handful of times doesn't judge any group", () => {
    const fewHits = structuredClone(readerAndScanner);
    fewHits.clusters[0].goal_hits = { g1: 3 };
    const result = interpretClusters({ desktop: fewHits, goal: { id: "g1", name: "checkout" } });
    assert.ok(Object.values(result.cluster_stories).every(s => !s.goal));
});
