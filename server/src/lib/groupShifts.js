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
    return clusters.map(c => ({ group: stories[c.id]?.headline || c.label, share: (c.n || 0) / total }));
}

function biggestShift(before, after, minShift) {
    const then = new Map((groupShares(before) || []).map(g => [g.group, g.share]));
    const now = new Map((groupShares(after) || []).map(g => [g.group, g.share]));
    let best = null;
    for (const group of new Set([...then.keys(), ...now.keys()])) {
        const from = then.get(group) || 0, to = now.get(group) || 0;
        if (Math.abs(to - from) >= minShift && (!best || Math.abs(to - from) > Math.abs(best.to - best.from))) best = { group, from, to };
    }
    return best;
}

module.exports = { groupShares, biggestShift };
