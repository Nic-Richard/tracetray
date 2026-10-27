const assert = require("node:assert/strict");
const { test } = require("node:test");
const { trackGroups } = require("../src/lib/groupTracking");
const { biggestShift } = require("../src/lib/groupShifts");
const { interpretClusters } = require("../src/lib/interpretClusters");

const spread = { click_rate: 1, scroll_depth_reached: 0.3, pause_rate: 0.5 };
const group = (id, n, click, depth, pause) => ({ id, n, centre: { click_rate: click, scroll_depth_reached: depth, pause_rate: pause } });
const analysis = (ranAt, clusters) => ({ ran_at: new Date(ranAt), spread, clusters, structure: "clear", interpretation: {} });

test("the same groups are linked even when the analysis numbers them differently", () => {
    const before = trackGroups(null, analysis("2026-10-05", [group(0, 50, 2, 0.4, 0.5), group(1, 30, 0.2, 0.9, 1.5)]));
    const after = trackGroups(before, analysis("2026-10-12", [group(0, 32, 0.25, 0.88, 1.4), group(1, 48, 2.1, 0.42, 0.5)]));
    assert.equal(after.clusters[0].track.id, before.clusters[1].track.id);
    assert.equal(after.clusters[1].track.id, before.clusters[0].track.id);
    assert.deepEqual(after.clusters[0].track.since, new Date("2026-10-05"));
    assert.equal(after.clusters.some(c => c.track.new), false);
});

test("a group that wasn't there before is new, and the first analysis marks nothing as new", () => {
    const before = trackGroups(null, analysis("2026-10-05", [group(0, 50, 2, 0.4, 0.5), group(1, 30, 0.2, 0.9, 1.5)]));
    assert.equal(before.clusters.some(c => c.track.new), false);
    const after = trackGroups(before, analysis("2026-10-12", [group(0, 50, 2, 0.4, 0.5), group(1, 30, 0.2, 0.9, 1.5), group(2, 20, 0, 0.05, 3)]));
    assert.equal(after.clusters[2].track.new, true);
    const untracked = { ran_at: new Date("2026-10-05"), clusters: [{ id: 0, n: 50 }] };
    assert.equal(trackGroups(untracked, analysis("2026-10-12", [group(0, 50, 2, 0.4, 0.5)])).clusters[0].track.new, false);
    assert.deepEqual(after.clusters[2].track.since, new Date("2026-10-12"));
});

test("a group that changed a lot gets a new identity instead of inheriting the old one", () => {
    const before = trackGroups(null, analysis("2026-10-05", [group(0, 50, 2, 0.4, 0.5)]));
    const after = trackGroups(before, analysis("2026-10-12", [group(0, 50, 0.2, 0.95, 2)]));
    assert.notEqual(after.clusters[0].track.id, before.clusters[0].track.id);
});

test("a renamed group with the same share is not reported as a shift", () => {
    const before = trackGroups(null, analysis("2026-10-05", [group(0, 60, 2, 0.4, 0.5), group(1, 40, 0.2, 0.9, 1.5)]));
    before.interpretation = { cluster_stories: { 0: { headline: "Quick deciders" }, 1: { headline: "Content skimmers" } } };
    const after = trackGroups(before, analysis("2026-10-12", [group(0, 60, 2, 0.4, 0.5), group(1, 40, 0.22, 0.88, 1.5)]));
    after.interpretation = { cluster_stories: { 0: { headline: "Quick deciders" }, 1: { headline: "Header scanners" } } };
    assert.equal(biggestShift(before, after, 0.1), null);
    after.clusters[1].n = 10;
    assert.equal(biggestShift(before, after, 0.1).group, "Header scanners");
});

test("a tracked group keeps its name while it still roughly fits", () => {
    const means = (velocity, pause, depth, top) => ({ avg_cursor_velocity: velocity, pause_rate: pause, scroll_depth_reached: depth, top_zone_ratio: top, click_rate: 0.02 });
    const clusters = [
        { id: 0, n: 100, feature_means: means(0.5, 0.6, 0.7, 0.4) },
        { id: 1, n: 100, feature_means: means(0.8, 0.4, 0.2, 0.8) },
    ];
    const name = track => interpretClusters({ desktop: { session_count: 200, kruskal_wallis: [],
        clusters: clusters.map(c => c.id === 1 ? { ...c, track } : c) } }).cluster_stories[1].key;
    assert.equal(name(undefined), "header_scanners");
    assert.equal(name({ previous_key: "skimmers" }), "skimmers");
    assert.equal(name({ previous_key: "deep_readers" }), "header_scanners", "a name that no longer fits isn't kept");
});
