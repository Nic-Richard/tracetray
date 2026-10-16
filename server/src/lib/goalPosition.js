const { Session } = require("../db/models");
const cursorDepths = require("../../../analysis/featureModules/pagePosition");
const { clickMatches } = require("./goals");

const MIN_CLICKS = 5;

const median = values => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

async function goalPosition(siteKey, page, goal, limit = 300) {
    if (!goal || goal.type !== "click" || !page) return null;
    const sessions = await Session.find(
        { site_key: siteKey, page, goal_hits: goal.id, detailed: { $ne: false }, "events.0": { $exists: true } },
        { _id: 0, events: 1, device_type: 1 }
    ).sort({ start_time: -1 }).limit(limit).lean();

    const depths = { desktop: [], mobile: [] };
    for (const session of sessions) {
        const hit = cursorDepths(session.events, ["click", "tap"]).find(p => p.depth !== null && clickMatches(goal, p.event));
        if (hit) depths[session.device_type === "mobile" ? "mobile" : "desktop"].push(hit.depth);
    }
    return {
        desktop: depths.desktop.length >= MIN_CLICKS ? median(depths.desktop) : null,
        mobile: depths.mobile.length >= MIN_CLICKS ? median(depths.mobile) : null
    };
}

module.exports = { goalPosition };
