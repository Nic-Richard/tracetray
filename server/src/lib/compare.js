// Before-and-after: the same number of days on each side of a change to a page (up to 14),
// so a site owner can see whether a redesign changed how visitors behave.
const { Session, AnalysisResult } = require("../db/models");
const { groupShares } = require("./groupShifts");

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS = 14;
const MAX_VISIT_MS = 30 * 60 * 1000;

async function windowMeasures(siteKey, page, from, to) {
    const [row] = await Session.aggregate([
        { $match: { site_key: siteKey, page, end_time: { $ne: null }, start_time: { $gte: from, $lt: to } } },
        { $project: {
            mobile: { $cond: [{ $eq: ["$device_type", "mobile"] }, 1, 0] },
            engaged: { $cond: [{ $and: [{ $gt: ["$summary.duration_ms", 5000] }, { $gt: ["$summary.total_events", 3] }] }, 1, 0] },
            duration: { $min: [{ $ifNull: ["$summary.duration_ms", 0] }, MAX_VISIT_MS] },
            actions: { $add: [{ $ifNull: ["$summary.clicks", 0] }, { $ifNull: ["$summary.taps", 0] }] },
            depth: { $max: "$events.scroll_depth" }
        } },
        { $group: {
            _id: null,
            visits: { $sum: 1 },
            mobile: { $sum: "$mobile" },
            engaged: { $sum: "$engaged" },
            duration: { $avg: "$duration" },
            actions: { $avg: "$actions" },
            depth: { $avg: "$depth" }
        } }
    ]);
    const days = (to - from) / DAY_MS;
    if (!row) return { visits: 0, visitsPerDay: 0, engaged: null, timeOnPage: null, actionsPerVisit: null, scrollDepth: null, phoneShare: null };
    return {
        visits: row.visits,
        visitsPerDay: row.visits / days,
        engaged: row.engaged / row.visits,
        timeOnPage: row.duration,
        actionsPerVisit: row.actions,
        scrollDepth: typeof row.depth === "number" ? row.depth : null,
        phoneShare: row.mobile / row.visits
    };
}

// `changedOn` is a YYYY-MM-DD day; the change counts from the start of that day (UTC).
async function compareAroundChange(siteKey, page, changedOn, now = Date.now()) {
    const changedAt = Date.parse(`${changedOn}T00:00:00Z`);
    const daysSince = Math.floor((now - changedAt) / DAY_MS);
    if (!Number.isFinite(changedAt) || daysSince < 1) return { ready: false, days: 0 };
    const days = Math.min(MAX_DAYS, daysSince);
    const [before, after, analysisBefore, analysisAfter] = await Promise.all([
        windowMeasures(siteKey, page, changedAt - days * DAY_MS, changedAt),
        windowMeasures(siteKey, page, changedAt, changedAt + days * DAY_MS),
        AnalysisResult.findOne({ site_key: siteKey, page, k: { $gt: 0 }, ran_at: { $lt: new Date(changedAt) } }).sort({ ran_at: -1 }).lean(),
        AnalysisResult.findOne({ site_key: siteKey, page, k: { $gt: 0 }, ran_at: { $gte: new Date(changedAt) } }).sort({ ran_at: -1 }).lean()
    ]);
    return {
        ready: true,
        days,
        before,
        after,
        groups: { before: groupShares(analysisBefore), after: groupShares(analysisAfter) }
    };
}

module.exports = { compareAroundChange };
