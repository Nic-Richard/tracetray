// Visitor-group shares from an analysis, named as the dashboard names them, and the group that
// moved most between two analyses of the same page.
function groupShares(result, device = "desktop") {
    if (!result) return null;
    const mobile = device === "mobile";
    const source = mobile ? result.mobile : result;
    // Groups that didn't hold up aren't real, so they can't shift.
    if (source?.structure === "none") return [];
    const clusters = source?.clusters || [];
    const total = clusters.reduce((sum, c) => sum + (c.n || 0), 0) || 1;
    const interpretation = result.interpretation || result.ai_interpretation || {};
    const stories = (mobile ? interpretation.mobile_cluster_stories : interpretation.cluster_stories) || {};
    return clusters.map(c => ({ group: stories[c.id]?.headline || c.label, track: c.track?.id || null, share: (c.n || 0) / total }));
}

// Groups are compared by their tracked identity, so a group that was only renamed doesn't count as one group
// vanishing and another appearing. Analyses from before tracking fall back to names.
function biggestShift(before, after, minShift) {
    const then = groupShares(before) || [], now = groupShares(after) || [];
    const tracked = now.some(g => g.track) && then.some(g => g.track);
    const keyOf = g => tracked && g.track ? g.track : g.group;
    const groups = new Map();
    for (const g of then) groups.set(keyOf(g), { group: g.group, from: g.share, to: 0 });
    for (const g of now) groups.set(keyOf(g), { ...(groups.get(keyOf(g)) || { from: 0 }), group: g.group, to: g.share });
    let best = null;
    for (const g of groups.values()) {
        if (Math.abs(g.to - g.from) >= minShift && (!best || Math.abs(g.to - g.from) > Math.abs(best.to - best.from))) best = g;
    }
    return best;
}

module.exports = { groupShares, biggestShift };
