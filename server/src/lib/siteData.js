const { Session, AnalysisResult } = require("../db/models");

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

function latestAnalysis(siteKey, page) {
    return AnalysisResult.findOne({ site_key: siteKey, page: analysisPageFilter(page) }).sort({ ran_at: -1 }).lean();
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

    const sessions = await Session.find(filter, { start_time: 1, device_type: 1, summary: 1, _id: 0 }).lean();

    const byDay = {};
    let engagedTotal = 0;

    for (const s of sessions) {
        const day = new Date(parseInt(s.start_time)).toISOString().slice(0, 10);
        if (!byDay[day]) byDay[day] = { date: day, desktop: 0, mobile: 0, engaged: 0 };

        const isMobile = s.device_type === "mobile";
        byDay[day][isMobile ? "mobile" : "desktop"]++;

        const engaged = (s.summary?.duration_ms || 0) > 5000 && (s.summary?.total_events || 0) > 3;
        if (engaged) { byDay[day].engaged++; engagedTotal++; }
    }

    const series = [];
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10);
        series.push(byDay[d] || { date: d, desktop: 0, mobile: 0, engaged: 0 });
    }

    return {
        series,
        total_sessions:   sessions.length,
        engaged_sessions: engagedTotal,
        engagement_rate:  sessions.length > 0 ? engagedTotal / sessions.length : 0
    };
}

// Uses session-weighted metrics because cluster labels can change between runs.
async function getUxTrends(siteKey, { page = "all", runs = 10, since = null } = {}) {
    const results = (await AnalysisResult.find({
        site_key: siteKey,
        page:     analysisPageFilter(page),
        k:        { $gt: 0 }, // skip failed/insufficient-data runs, they have no feature means
        ...(since ? { ran_at: { $gte: since } } : {})
    }).sort({ ran_at: -1 }).limit(runs).lean()).reverse();

    const points = results.map(r => {
        const clusters = r.clusters || [];
        const total    = clusters.reduce((s, c) => s + (c.n || 0), 0) || 1;

        function weightedAvg(key) {
            let sum = 0;
            for (const c of clusters) {
                const v = c.feature_means?.[key];
                if (v != null) sum += v * (c.n || 0);
            }
            return sum / total;
        }

        const hasDesktopFeatures = clusters.some(c => c.feature_means?.dwell_before_click != null);
        const hesitation = hasDesktopFeatures ? weightedAvg("dwell_before_click") : weightedAvg("dwell_before_tap");
        const readingPauses = hasDesktopFeatures
            ? weightedAvg("pause_rate")
            : weightedAvg("attention_pause_rate") || weightedAvg("scroll_pause_rate");
        const scrollDepth = weightedAvg("scroll_depth_reached") || weightedAvg("scroll_depth_norm");

        const topClick = (r.click_summary || [])[0] || null;
        const ctr = topClick && r.session_count > 0 ? topClick.count / r.session_count : null;

        return {
            ran_at:          r.ran_at,
            session_count:   r.session_count,
            hesitation_ms:   hesitation || null,
            reading_pauses:  readingPauses || null,
            scroll_depth:    scrollDepth || null,
            ctr:             ctr,
            top_click_text:  topClick?.text || null
        };
    });

    return { page, points, has_ctr_history: points.some(p => p.ctr != null) };
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

async function getJourney(siteKey) {
    const sessions = await Session.find(
        { site_key: siteKey, end_time: { $ne: null }, visitor_id: { $ne: null } },
        { visitor_id: 1, page: 1, start_time: 1, _id: 0 }
    ).sort({ start_time: 1 }).lean();

    const byVisitor = {};
    for (const s of sessions) {
        if (!byVisitor[s.visitor_id]) byVisitor[s.visitor_id] = [];
        byVisitor[s.visitor_id].push(s.page);
    }

    const journeys = Object.values(byVisitor);
    const entryCounts = {}, exitCounts = {}, transitions = {}, pathCounts = {};
    for (const j of journeys) {
        entryCounts[j[0]] = (entryCounts[j[0]] || 0) + 1;
        exitCounts[j[j.length - 1]] = (exitCounts[j[j.length - 1]] || 0) + 1;
        for (let i = 0; i < j.length - 1; i++) {
            const key = `${j[i]} -> ${j[i+1]}`;
            transitions[key] = (transitions[key] || 0) + 1;
        }
        const path = j.slice(0, 3).join(" → ");
        pathCounts[path] = (pathCounts[path] || 0) + 1;
    }

    const totalVisitors     = journeys.length;
    const multiPageVisitors = journeys.filter(j => j.length > 1).length;

    return {
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
    const sessions = await Session.find({
        site_key: siteKey,
        end_time: { $ne: null },
        start_time: { $gte: Date.now() - days * DAY_MS },
        ...(page ? { page } : {})
    }, { referrer: 1, _id: 0 }).lean();

    const counts = {};
    for (const s of sessions) {
        const host = referrerHost(s.referrer, ownHost);
        counts[host] = (counts[host] || 0) + 1;
    }
    return { days, total_sessions: sessions.length, sources: topCounts(counts, limit, "source") };
}

module.exports = {
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
