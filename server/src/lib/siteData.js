const { Session, AnalysisResult } = require("../db/models");
const { ENGAGED } = require("./tracking");
const { windowMeasures } = require("./compare");
const { interpretClusters } = require("./interpretClusters");

const DAY_MS = 24 * 60 * 60 * 1000;

// Mobile sessions use touch and scroll events instead of cursor movement.
const INTERACTION_FILTER = {
    $or: [
        { "summary.mouse_moves": { $gt: 0 } },
        { "summary.taps": { $gt: 0 } },
        { "summary.scrolls": { $gt: 0 } }
    ]
};

function analysisPageFilter(page) {
    return page && page !== "all" ? page : { $in: ["all", null] };
}

async function getSessionCounts(siteKey, page) {
    const filter     = { site_key: siteKey };
    const pageFilter = page && page !== "all" ? { page } : {};
    const analysableFilter = { ...filter, ...pageFilter, end_time: { $ne: null }, ...INTERACTION_FILTER };

    const [total, analysable, desktop, mobile, siteAnalysable] = await Promise.all([
        Session.countDocuments({ ...filter, ...pageFilter, end_time: { $ne: null } }),
        Session.countDocuments(analysableFilter),
        Session.countDocuments({ ...analysableFilter, device_type: { $ne: "mobile" } }),
        Session.countDocuments({ ...analysableFilter, device_type: "mobile" }),
        Session.countDocuments({ ...filter, end_time: { $ne: null }, ...INTERACTION_FILTER })
    ]);

    return { total, analysable, desktop, mobile, siteAnalysable };
}

// Signs that a page's visit count overstates its real audience.
async function getVisitQuality(siteKey, page) {
    const filter = { site_key: siteKey, end_time: { $ne: null }, ...(page && page !== "all" ? { page } : {}) };
    const [total, interactive, short] = await Promise.all([
        Session.countDocuments(filter),
        Session.countDocuments({ ...filter, ...INTERACTION_FILTER }),
        Session.countDocuments({ ...filter, "summary.duration_ms": { $lt: 3000 } })
    ]);
    return { total, without_interaction: total - interactive, under_3_seconds: short };
}

async function latestAnalysis(siteKey, page) {
    const result = await AnalysisResult.findOne({ site_key: siteKey, page: analysisPageFilter(page) }).sort({ ran_at: -1 }).lean();
    if (result?.interpretation?.source === "rules") {
        result.interpretation = interpretClusters({ desktop: result, mobile: result.mobile, pageUrl: result.page, goal: result.goal });
        result.interpretation.first_impression_note = null;
    }
    return result;
}

async function getTimeseries(siteKey, { days = 14, page = null } = {}) {
    // Start at midnight UTC of the first charted day so the total matches the daily series.
    const firstDay = new Date(Date.now() - (days - 1) * DAY_MS).toISOString().slice(0, 10);
    const cutoff = Date.parse(`${firstDay}T00:00:00Z`);
    const filter = {
        site_key: siteKey,
        end_time: { $ne: null },
        start_time: { $gte: cutoff },
        ...(page ? { page } : {})
    };

    const isMobile = { $eq: ["$device_type", "mobile"] };
    const rows = await Session.aggregate([
        { $match: filter },
        { $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: { $toDate: { $convert: { input: "$start_time", to: "long", onError: 0, onNull: 0 } } } } },
            desktop: { $sum: { $cond: [isMobile, 0, 1] } },
            mobile: { $sum: { $cond: [isMobile, 1, 0] } },
            engaged: { $sum: { $cond: [ENGAGED, 1, 0] } }
        } }
    ]);
    const byDay = Object.fromEntries(rows.map(r => [r._id, { date: r._id, desktop: r.desktop, mobile: r.mobile, engaged: r.engaged }]));
    const totalSessions = rows.reduce((sum, r) => sum + r.desktop + r.mobile, 0);
    const engagedTotal = rows.reduce((sum, r) => sum + r.engaged, 0);

    const series = [];
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10);
        series.push(byDay[d] || { date: d, desktop: 0, mobile: 0, engaged: 0 });
    }

    return {
        series,
        total_sessions:   totalSessions,
        engaged_sessions: engagedTotal,
        engagement_rate:  totalSessions > 0 ? engagedTotal / totalSessions : 0
    };
}

// Calendar weeks from Monday (UTC), like the goal chart, so two refreshes on the same day can't fake a trend.
// The last week is the current one, still in progress.
async function getUxTrends(siteKey, { page = "all", weeks = 8, since = null, now = Date.now() } = {}) {
    const WEEK_MS = 7 * DAY_MS;
    const today = Math.floor(now / DAY_MS) * DAY_MS;
    const monday = today - ((new Date(today).getUTCDay() + 6) % 7) * DAY_MS;
    const oldest = since ? new Date(since).getTime() : -Infinity;
    const windows = [];
    for (let i = weeks - 1; i >= 0; i--) {
        const from = monday - i * WEEK_MS;
        if (from + WEEK_MS > oldest) windows.push({ from, to: Math.min(from + WEEK_MS, now) });
    }
    const pageKey = page === "all" ? null : page;
    const measured = await Promise.all(windows.map(w => windowMeasures(siteKey, pageKey, w.from, w.to)));
    const points = windows.map((w, i) => {
        const m = measured[i];
        return {
            week_start:        new Date(w.from).toISOString(),
            visits:            m.visits,
            engaged:           m.visits ? m.engaged : null,
            time_on_page_ms:   m.visits ? m.timeOnPage : null,
            actions_per_visit: m.visits ? m.actionsPerVisit : null,
            scroll_depth:      m.scrollDepth,
            phone_share:       m.visits ? m.phoneShare : null
        };
    });
    return { page, points };
}

async function getPages(siteKey) {
    const pages = await Session.aggregate([
        { $match: { site_key: siteKey, end_time: { $ne: null }, page: { $ne: null } } },
        { $group: {
            _id:        "$page",
            sessions:   { $sum: 1 },
            analysable: { $sum: { $cond: [
                { $or: [
                    { $gt: ["$summary.mouse_moves", 0] },
                    { $gt: ["$summary.taps", 0] },
                    { $gt: ["$summary.scrolls", 0] }
                ]},
                1, 0
            ]}},
            last_seen:  { $max: "$start_time" }
        }},
        { $sort: { sessions: -1 } }
    ]);

    return pages.map(p => ({
        page:       p._id,
        sessions:   p.sessions,
        analysable: p.analysable,
        last_seen:  p.last_seen
    }));
}

function topCounts(counts, limit, key) {
    return Object.entries(counts)
        .sort((a, b) => b[1] - a[1]).slice(0, limit)
        .map(([value, count]) => ({ [key]: value, count }));
}

const JOURNEY_GAP_MS = 30 * 60 * 1000;

const MAX_TALLY_KEYS = 50000;

const timeOf = value => typeof value === "number" ? value : Date.parse(value) || null;

// One journey per visitor until they've been away for 30 minutes, matching Google Analytics' session rule.
// Visitor IDs change daily, so a journey can't outlive the day either.
function splitJourneys(sessions) {
    const open = new Map();
    const journeys = [];
    for (const s of sessions) {
        const start = timeOf(s.start_time);
        const current = open.get(s.visitor_id);
        if (current && start !== null && current.lastActive !== null && start - current.lastActive <= JOURNEY_GAP_MS) {
            current.pages.push(s.page);
        } else {
            const journey = { pages: [s.page], lastActive: null };
            journeys.push(journey);
            open.set(s.visitor_id, journey);
        }
        const last = open.get(s.visitor_id);
        last.lastActive = Math.max(last.lastActive || 0, timeOf(s.end_time) || start || 0) || null;
    }
    return journeys.map(j => j.pages);
}

// Journeys over the last `days`, read one visitor at a time so memory doesn't grow with traffic.
async function getJourney(siteKey, { days = 30, now = Date.now() } = {}) {
    const cursor = Session.find(
        { site_key: siteKey, end_time: { $ne: null }, visitor_id: { $ne: null }, start_time: { $gte: now - days * DAY_MS } },
        { visitor_id: 1, page: 1, start_time: 1, end_time: 1, _id: 0 }
    ).sort({ visitor_id: 1, start_time: 1 }).lean().cursor();

    const entryCounts = {}, exitCounts = {}, transitions = {}, pathCounts = {};
    let totalVisitors = 0, multiPageVisitors = 0;
    // Distinct moves and paths can run into millions on big sites, so each tally stops taking new keys at a cap.
    // Visitor IDs are hashes, so the visitors seen before the cap are a fair sample for the top lists.
    const sizes = new Map();
    const bump = (counts, key) => {
        if (counts[key] === undefined) {
            if ((sizes.get(counts) || 0) >= MAX_TALLY_KEYS) return;
            sizes.set(counts, (sizes.get(counts) || 0) + 1);
            counts[key] = 0;
        }
        counts[key]++;
    };
    const count = j => {
        bump(entryCounts, j[0]);
        bump(exitCounts, j[j.length - 1]);
        for (let i = 0; i < j.length - 1; i++) {
            const key = `${j[i]} -> ${j[i+1]}`;
            bump(transitions, key);
        }
        const path = j.slice(0, 3).join(" → ");
        bump(pathCounts, path);
        totalVisitors++;
        if (j.length > 1) multiPageVisitors++;
    };
    let visitor = null, visits = [];
    const flush = () => { for (const j of splitJourneys(visits)) count(j); };
    for await (const s of cursor) {
        if (s.visitor_id !== visitor) { flush(); visitor = s.visitor_id; visits = []; }
        visits.push(s);
    }
    flush();

    return {
        days,
        total_visitors:       totalVisitors,
        multi_page_visitors:  multiPageVisitors,
        single_page_visitors: totalVisitors - multiPageVisitors,
        top_entries:          topCounts(entryCounts, 10, "page"),
        top_exits:            topCounts(exitCounts, 10, "page"),
        top_transitions:      topCounts(transitions, 15, "path"),
        top_paths:            topCounts(pathCounts, 10, "path")
    };
}

function referrerHost(referrer, ownHost = null) {
    if (!referrer) return "direct";
    try {
        const host = new URL(referrer).hostname.replace(/^www\./, "");
        if (!host) return "direct";
        return ownHost && (host === ownHost || host.endsWith(`.${ownHost}`)) ? "internal (moving between your pages)" : host;
    } catch { return "other"; }
}

async function getReferrers(siteKey, { days = 30, page = null, limit = 15, ownHost = null } = {}) {
    const rows = await Session.aggregate([
        { $match: { site_key: siteKey, end_time: { $ne: null }, start_time: { $gte: Date.now() - days * DAY_MS }, ...(page ? { page } : {}) } },
        { $group: { _id: "$referrer", n: { $sum: 1 } } }
    ]);
    const counts = {};
    for (const row of rows) {
        const host = referrerHost(row._id, ownHost);
        counts[host] = (counts[host] || 0) + row.n;
    }
    return { days, total_sessions: rows.reduce((sum, row) => sum + row.n, 0), sources: topCounts(counts, limit, "source") };
}

module.exports = {
    splitJourneys,
    getSessionCounts,
    getVisitQuality,
    latestAnalysis,
    getTimeseries,
    getUxTrends,
    getPages,
    getJourney,
    getReferrers,
    referrerHost
};
