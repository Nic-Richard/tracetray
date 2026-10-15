// Before-and-after: the same number of days on each side of a change to a page (up to 14),
// so a site owner can see whether a redesign changed how visitors behave.
const { Session, AnalysisResult } = require("../db/models");
const { groupShares } = require("./groupShifts");

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS = 14;
const MAX_VISIT_MS = 30 * 60 * 1000;
const MIN_GOAL_REACHED = 30;

async function windowMeasures(siteKey, page, from, to, goalId = null) {
    const [row] = await Session.aggregate([
        { $match: { site_key: siteKey, page, end_time: { $ne: null }, start_time: { $gte: from, $lt: to } } },
        { $project: {
            mobile: { $cond: [{ $eq: ["$device_type", "mobile"] }, 1, 0] },
            engaged: { $cond: [{ $and: [{ $gt: ["$summary.duration_ms", 5000] }, { $gt: ["$summary.total_events", 3] }] }, 1, 0] },
            duration: { $min: [{ $ifNull: ["$summary.duration_ms", 0] }, MAX_VISIT_MS] },
            actions: { $add: [{ $ifNull: ["$summary.clicks", 0] }, { $ifNull: ["$summary.taps", 0] }] },
            depth: { $ifNull: ["$max_scroll_depth", { $max: "$events.scroll_depth" }] },
            reached: { $cond: [{ $in: [goalId, { $ifNull: ["$goal_hits", []] }] }, 1, 0] }
        } },
        { $group: {
            _id: null,
            visits: { $sum: 1 },
            mobile: { $sum: "$mobile" },
            engaged: { $sum: "$engaged" },
            duration: { $avg: "$duration" },
            actions: { $avg: "$actions" },
            depth: { $avg: "$depth" },
            reached: { $sum: "$reached" }
        } }
    ]);
    const days = (to - from) / DAY_MS;
    if (!row) return { visits: 0, visitsPerDay: 0, engaged: null, timeOnPage: null, actionsPerVisit: null, scrollDepth: null, phoneShare: null, goalReached: 0 };
    return {
        visits: row.visits,
        visitsPerDay: row.visits / days,
        engaged: row.engaged / row.visits,
        timeOnPage: row.duration,
        actionsPerVisit: row.actions,
        scrollDepth: typeof row.depth === "number" ? row.depth : null,
        phoneShare: row.mobile / row.visits,
        goalReached: row.reached
    };
}

// Did the goal rate change? A two-proportion z-test at 95%, and no verdict until 30 visits have reached the goal.
function goalVerdict(before, after) {
    const reached = before.goalReached + after.goalReached;
    const visits = before.visits + after.visits;
    if (reached < MIN_GOAL_REACHED || !before.visits || !after.visits) return "unclear";
    const pooled = reached / visits;
    const spread = Math.sqrt(pooled * (1 - pooled) * (1 / before.visits + 1 / after.visits));
    const z = (after.goalReached / after.visits - before.goalReached / before.visits) / spread;
    return z >= 1.96 ? "better" : z <= -1.96 ? "worse" : "same";
}

// `changedOn` is a YYYY-MM-DD day; the change counts from the start of that day (UTC).
async function compareAroundChange(siteKey, page, changedOn, now = Date.now(), goal = null) {
    const changedAt = Date.parse(`${changedOn}T00:00:00Z`);
    const daysSince = Math.floor((now - changedAt) / DAY_MS);
    if (!Number.isFinite(changedAt) || daysSince < 1) return { ready: false, days: 0 };
    const days = Math.min(MAX_DAYS, daysSince);
    const [before, after, analysisBefore, analysisAfter] = await Promise.all([
        windowMeasures(siteKey, page, changedAt - days * DAY_MS, changedAt, goal?.id),
        windowMeasures(siteKey, page, changedAt, changedAt + days * DAY_MS, goal?.id),
        AnalysisResult.findOne({ site_key: siteKey, page, k: { $gt: 0 }, ran_at: { $lt: new Date(changedAt) } }).sort({ ran_at: -1 }).lean(),
        AnalysisResult.findOne({ site_key: siteKey, page, k: { $gt: 0 }, ran_at: { $gte: new Date(changedAt) } }).sort({ ran_at: -1 }).lean()
    ]);
    return {
        ready: true,
        days,
        before,
        after,
        groups: { before: groupShares(analysisBefore), after: groupShares(analysisAfter) },
        goal: goal ? {
            id: goal.id,
            name: goal.name,
            before: before.visits ? before.goalReached / before.visits : null,
            after: after.visits ? after.goalReached / after.visits : null,
            reached: before.goalReached + after.goalReached,
            verdict: goalVerdict(before, after)
        } : null
    };
}

module.exports = { compareAroundChange, goalVerdict };
