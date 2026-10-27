// Links each visitor group to the same group in the page's previous analysis, so it keeps its identity, name
// and start date from week to week.
const crypto = require("crypto");

// Distance between group centres, in each measure's spread. Measured on the demo store: the same group seen in
// two samples sits at 0.00-0.36, different groups at 0.74 or more.
const SAME_GROUP = 0.5;

function distance(a, b, spreadA, spreadB) {
    const features = Object.keys(a || {}).filter(f => f in (b || {}) && spreadA?.[f] > 0 && spreadB?.[f] > 0);
    if (features.length === 0) return Infinity;
    const sum = features.reduce((total, f) => total + ((a[f] - b[f]) / ((spreadA[f] + spreadB[f]) / 2)) ** 2, 0);
    return Math.sqrt(sum / features.length);
}

function permutations(items, size) {
    if (size === 0) return [[]];
    return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)], size - 1).map(rest => [item, ...rest]));
}

// The pairing with the smallest total distance, keeping only pairs close enough to be the same group.
// At most five groups a side, so trying every pairing is cheap.
function matchGroups(previous, current, spreadPrev, spreadCur) {
    const d = previous.map(p => current.map(c => distance(p.centre, c.centre, spreadPrev, spreadCur)));
    const prevFewer = previous.length <= current.length;
    const fixed = (prevFewer ? previous : current).map((_, i) => i);
    const others = (prevFewer ? current : previous).map((_, i) => i);
    let best = null;
    for (const picks of permutations(others, fixed.length)) {
        const pairs = fixed.map((f, i) => prevFewer ? [f, picks[i]] : [picks[i], f]);
        // Pairs too far apart to be the same group all cost the same, so they don't sway the rest.
        const cost = pairs.reduce((total, [p, c]) => total + Math.min(d[p][c], SAME_GROUP * 2), 0);
        if (!best || cost < best.cost) best = { cost, pairs };
    }
    return new Map((best?.pairs || []).filter(([p, c]) => d[p][c] <= SAME_GROUP)
        .map(([p, c]) => [current[c].id, { group: previous[p], distance: d[p][c] }]));
}

function trackDevice(previous, current, previousStories, ranAt, previousRanAt) {
    const clusters = current?.clusters || [];
    // Analyses from before tracking have no centres to compare, so their groups can't be linked or called new.
    const before = previous?.spread ? previous.clusters || [] : [];
    const matches = before.length ? matchGroups(before, clusters, previous.spread, current.spread) : new Map();
    for (const cluster of clusters) {
        const prev = matches.get(cluster.id)?.group;
        cluster.track = prev
            ? { id: prev.track?.id || newId(), since: prev.track?.since || previousRanAt, previous_id: prev.id, previous_key: previousStories?.[prev.id]?.key || null }
            : { id: newId(), since: ranAt, new: before.length > 0 };
    }
}

const newId = () => crypto.randomUUID().slice(0, 8);

function trackGroups(previous, current) {
    const stories = previous?.interpretation || {};
    trackDevice(previous, current, stories.cluster_stories, current.ran_at, previous?.ran_at);
    if (current.mobile) trackDevice(previous?.mobile, current.mobile, stories.mobile_cluster_stories, current.ran_at, previous?.ran_at);
    return current;
}

module.exports = { trackGroups, matchGroups, distance, SAME_GROUP };
