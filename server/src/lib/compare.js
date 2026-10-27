const { Session, AnalysisResult } = require("../db/models");
const { groupShares } = require("./groupShifts");
const { ENGAGED } = require("./tracking");

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS = 14;
const MAX_VISIT_MS = 30 * 60 * 1000;
const MIN_GOAL_REACHED = 30;

async function windowMeasures(siteKey, page, from, to, goalId = null, device = null) {
    const [row] = await Session.aggregate([
        { $match: { site_key: siteKey, ...(page ? { page } : {}), ...(device ? { device_type: device === "mobile" ? "mobile" : { $ne: "mobile" } } : {}),
            end_time: { $ne: null }, start_time: { $gte: from, $lt: to } } },
        { $project: {
            mobile: { $cond: [{ $eq: ["$device_type", "mobile"] }, 1, 0] },
            engaged: { $cond: [ENGAGED, 1, 0] },
            duration: { $min: [{ $ifNull: ["$summary.duration_ms", 0] }, MAX_VISIT_MS] },
            actions: { $add: [{ $ifNull: ["$summary.clicks", 0] }, { $ifNull: ["$summary.taps", 0] }] },
            depth: { $ifNull: ["$max_scroll_depth", { $max: { $map: { input: { $filter: { input: { $ifNull: ["$events", []] }, cond: { $eq: ["$$this.type", "scroll"] } } }, in: "$$this.scroll_depth" } } }] },
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

function wilson(reached, visits) {
    const p = reached / visits, z2 = 1.96 ** 2;
    const centre = (p + z2 / (2 * visits)) / (1 + z2 / visits);
    const spread = 1.96 * Math.sqrt(p * (1 - p) / visits + z2 / (4 * visits ** 2)) / (1 + z2 / visits);
    return [centre - spread, centre + spread];
}

// Newcombe's interval combines Wilson bounds without collapsing at zero or all conversions.
function goalDifferenceInterval(before, after) {
    if (!before.visits || !after.visits) return null;
    const b = before.goalReached / before.visits, a = after.goalReached / after.visits;
    const [bl, bu] = wilson(before.goalReached, before.visits), [al, au] = wilson(after.goalReached, after.visits);
    return [a - b - Math.hypot(a - al, bu - b), a - b + Math.hypot(au - a, b - bl)];
}

function goalVerdict(before, after) {
    if (before.goalReached + after.goalReached < MIN_GOAL_REACHED || before.visits < 30 || after.visits < 30) return "unclear";
    const [lower, upper] = goalDifferenceInterval(before, after);
    return lower > 0 ? "better" : upper < 0 ? "worse" : "same";
}

async function compareAroundChange(siteKey, page, changedOn, now = Date.now(), goal = null, device = null) {
    const changedAt = Date.parse(`${changedOn}T00:00:00Z`);
    const afterStart = changedAt + DAY_MS;
    const daysSince = Math.floor((now - afterStart) / DAY_MS);
    if (!Number.isFinite(changedAt) || daysSince < 1) return { ready: false, days: 0, device, provisional: true };
    const days = Math.min(MAX_DAYS, daysSince);
    const provisional = days < MAX_DAYS;
    const [before, after, analysisBefore, analysisAfter] = await Promise.all([
        windowMeasures(siteKey, page, changedAt - days * DAY_MS, changedAt, goal?.id, device),
        windowMeasures(siteKey, page, afterStart, afterStart + days * DAY_MS, goal?.id, device),
        device ? null : AnalysisResult.findOne({ site_key: siteKey, page, k: { $gt: 0 }, ran_at: { $lt: new Date(changedAt) } }).sort({ ran_at: -1 }).lean(),
        device ? null : AnalysisResult.findOne({ site_key: siteKey, page, k: { $gt: 0 }, ran_at: { $gte: new Date(afterStart) } }).sort({ ran_at: -1 }).lean()
    ]);
    const scopeOf = analysis => analysis ? { ran_at: analysis.ran_at, visits: analysis.session_count,
        from: analysis.scope?.from || null, to: analysis.scope?.to || null } : null;
    return {
        ready: true,
        days,
        device,
        provisional,
        before,
        after,
        groups: { before: groupShares(analysisBefore), after: groupShares(analysisAfter),
            before_scope: scopeOf(analysisBefore), after_scope: scopeOf(analysisAfter) },
        goal: goal ? {
            id: goal.id,
            name: goal.name,
            before: before.visits ? before.goalReached / before.visits : null,
            after: after.visits ? after.goalReached / after.visits : null,
            reached: before.goalReached + after.goalReached,
            before_reached: before.goalReached,
            after_reached: after.goalReached,
            difference_ci: goalDifferenceInterval(before, after),
            provisional,
            verdict: provisional ? "unclear" : goalVerdict(before, after)
        } : null
    };
}

module.exports = { compareAroundChange, goalVerdict, goalDifferenceInterval, windowMeasures };
