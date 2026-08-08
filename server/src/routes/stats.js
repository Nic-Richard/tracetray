const express = require("express");
const router = express.Router();
const { getAuth } = require("@clerk/express");
const { requireAuth } = require("../middleware/auth");
const { Account, Session, AnalysisResult } = require("../db/models");
const { resolveSiteKey } = require("../lib/siteAccount");
const { getClickSummary } = require("../lib/clickSummary");
const { computeAttentionProfile } = require("../lib/attentionProfile");
const logger = require("../lib/logger");

router.get("/api/stats", requireAuth(), async (req, res) => {
    try {
        const account = await Account.findOne({ clerk_user_id: getAuth(req).userId }).lean();
        if (!account) return res.status(404).json({ error: "account not found" });

        const siteKey = resolveSiteKey(req, account);
        if (!siteKey) return res.status(403).json({ error: "website not available" });

        const page   = req.query.page || "all";
        const filter = { site_key: siteKey };
        const pageFilter = page !== "all" ? { page } : {};

        const totalSessions = await Session.countDocuments({ ...filter, ...pageFilter, end_time: { $ne: null } });

// Mobile sessions use touch and scroll events instead of cursor movement.
        const interactionFilter = {
            $or: [
                { "summary.mouse_moves": { $gt: 0 } },
                { "summary.taps": { $gt: 0 } },
                { "summary.scrolls": { $gt: 0 } }
            ]
        };
        const analysableFilter = { ...filter, ...pageFilter, end_time: { $ne: null }, ...interactionFilter };
        const analysableSessions = await Session.countDocuments(analysableFilter);
        const desktopSessions    = await Session.countDocuments({ ...analysableFilter, device_type: { $ne: "mobile" } });
        const mobileSessions     = await Session.countDocuments({ ...analysableFilter, device_type: "mobile" });
        const siteAnalysableSessions = await Session.countDocuments({ ...filter, end_time: { $ne: null }, ...interactionFilter });

        const lastResult = await AnalysisResult.findOne({ ...filter, page: page !== "all" ? page : { $in: [page, null, "all"] } }).sort({ ran_at: -1 }).lean();

        const clickSummary = lastResult
            ? await getClickSummary(siteKey, page, 15)
            : [];

        res.json({
            total_sessions:          totalSessions,
            analysable_sessions:     analysableSessions,
            site_analysable_sessions: siteAnalysableSessions,
            desktop_sessions:        desktopSessions,
            mobile_sessions:         mobileSessions,
            last_analysis:           lastResult || null,
            plan:                    account.plan,
            site_key:                siteKey,
            click_summary:           clickSummary
        });
    } catch (err) {
        logger.error("stats error:", err);
        res.status(500).json({ error: "failed to fetch stats" });
    }
});

router.get("/api/sessions/recent", requireAuth(), async (req, res) => {
    try {
        const account  = await Account.findOne({ clerk_user_id: getAuth(req).userId }).lean();
        if (!account)  return res.status(404).json({ error: "account not found" });

        const siteKey = resolveSiteKey(req, account);
        if (!siteKey) return res.status(403).json({ error: "website not available" });

        const limit    = Math.min(parseInt(req.query.limit) || 20, 100);
        const sessions = await Session.find(
            { site_key: siteKey, end_time: { $ne: null } },
            { session_id:1, start_time:1, end_time:1, page:1, summary:1, device_type:1, _id:0 }
        ).sort({ start_time: -1 }).limit(limit).lean();

        res.json(sessions);
    } catch (err) {
        logger.error("sessions error:", err);
        res.status(500).json({ error: "failed to fetch sessions" });
    }
});

router.get("/api/sessions/timeseries", requireAuth(), async (req, res) => {
    try {
        const account = await Account.findOne({ clerk_user_id: getAuth(req).userId }).lean();
        if (!account) return res.status(404).json({ error: "account not found" });

        const siteKey = resolveSiteKey(req, account);
        if (!siteKey) return res.status(403).json({ error: "website not available" });

        const days   = Math.min(parseInt(req.query.days) || 14, 90);
        const page   = req.query.page || null;
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

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
            const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
            series.push(byDay[d] || { date: d, desktop: 0, mobile: 0, engaged: 0 });
        }

        res.json({
            series,
            total_sessions:  sessions.length,
            engaged_sessions: engagedTotal,
            engagement_rate:  sessions.length > 0 ? engagedTotal / sessions.length : 0
        });
    } catch (err) {
        logger.error("timeseries error:", err);
        res.status(500).json({ error: "failed to fetch session trend" });
    }
});

// Uses session-weighted metrics because cluster labels can change between runs.
router.get("/api/ux-trends", requireAuth(), async (req, res) => {
    try {
        const account = await Account.findOne({ clerk_user_id: getAuth(req).userId }).lean();
        if (!account) return res.status(404).json({ error: "account not found" });

        const siteKey = resolveSiteKey(req, account);
        if (!siteKey) return res.status(403).json({ error: "website not available" });

        const page  = req.query.page || "all";
        const runs  = Math.min(parseInt(req.query.runs) || 10, 30);

        const results = await AnalysisResult.find({
            site_key: siteKey,
            page:     page !== "all" ? page : { $in: [page, null, "all"] },
            k:        { $gt: 0 } // skip failed/insufficient-data runs, they have no feature means
        }).sort({ ran_at: 1 }).limit(runs).lean();

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

        res.json({
            page,
            points,
            has_ctr_history: points.some(p => p.ctr != null)
        });
    } catch (err) {
        logger.error("ux-trends error:", err);
        res.status(500).json({ error: "failed to fetch UX trends" });
    }
});

router.get("/api/pages", requireAuth(), async (req, res) => {
    try {
        const account = await Account.findOne({ clerk_user_id: getAuth(req).userId }).lean();
        if (!account) return res.status(404).json({ error: "account not found" });

        const siteKey = resolveSiteKey(req, account);
        if (!siteKey) return res.status(403).json({ error: "website not available" });

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

        res.json(pages.map(p => ({
            page:       p._id,
            sessions:   p.sessions,
            analysable: p.analysable,
            last_seen:  p.last_seen
        })));
    } catch (err) {
        logger.error("pages error:", err);
        res.status(500).json({ error: "failed to fetch pages" });
    }
});

router.post("/api/pages/reset", requireAuth(), async (req, res) => {
    try {
        const account = await Account.findOne({ clerk_user_id: getAuth(req).userId }).lean();
        if (!account) return res.status(404).json({ error: "account not found" });

        const siteKey = resolveSiteKey(req, account);
        if (!siteKey) return res.status(403).json({ error: "website not available" });

        const { page } = req.body;
        if (!page) return res.status(400).json({ error: "page is required" });

        const result = await Session.deleteMany({ site_key: siteKey, page });
        await AnalysisResult.deleteMany({ site_key: siteKey, page });

        res.json({ deleted_sessions: result.deletedCount });
    } catch (err) {
        logger.error("page reset error:", err);
        res.status(500).json({ error: "failed to reset page history" });
    }
});

router.get("/api/journey", requireAuth(), async (req, res) => {
    try {
        const account = await Account.findOne({ clerk_user_id: getAuth(req).userId }).lean();
        if (!account) return res.status(404).json({ error: "account not found" });

        const siteKey = resolveSiteKey(req, account);
        if (!siteKey) return res.status(403).json({ error: "website not available" });

        const filter = { site_key: siteKey, end_time: { $ne: null }, visitor_id: { $ne: null } };

        const sessions = await Session.find(filter, {
            visitor_id: 1, page: 1, start_time: 1, end_time: 1, referrer: 1, summary: 1, _id: 0
        }).sort({ start_time: 1 }).lean();

        const byVisitor = {};
        for (const s of sessions) {
            if (!byVisitor[s.visitor_id]) byVisitor[s.visitor_id] = [];
            byVisitor[s.visitor_id].push(s);
        }

        const journeys = Object.values(byVisitor)
            .filter(v => v.length >= 1)
            .map(visits => visits.map(v => v.page));

        const entryCounts = {};
        for (const j of journeys) {
            entryCounts[j[0]] = (entryCounts[j[0]] || 0) + 1;
        }

        const exitCounts = {};
        for (const j of journeys) {
            const last = j[j.length - 1];
            exitCounts[last] = (exitCounts[last] || 0) + 1;
        }

        const transitions = {};
        for (const j of journeys) {
            for (let i = 0; i < j.length - 1; i++) {
                const key = `${j[i]} -> ${j[i+1]}`;
                transitions[key] = (transitions[key] || 0) + 1;
            }
        }

        const pathCounts = {};
        for (const j of journeys) {
            const path = j.slice(0, 3).join(" → ");
            pathCounts[path] = (pathCounts[path] || 0) + 1;
        }

        const totalVisitors  = Object.keys(byVisitor).length;
        const multiPageVisitors = journeys.filter(j => j.length > 1).length;

        const topEntries = Object.entries(entryCounts)
            .sort((a,b) => b[1]-a[1]).slice(0,10)
            .map(([page, count]) => ({ page, count }));

        const topExits = Object.entries(exitCounts)
            .sort((a,b) => b[1]-a[1]).slice(0,10)
            .map(([page, count]) => ({ page, count }));

        const topTransitions = Object.entries(transitions)
            .sort((a,b) => b[1]-a[1]).slice(0,15)
            .map(([path, count]) => ({ path, count }));

        const topPaths = Object.entries(pathCounts)
            .sort((a,b) => b[1]-a[1]).slice(0,10)
            .map(([path, count]) => ({ path, count }));

        res.json({
            total_visitors:       totalVisitors,
            multi_page_visitors:  multiPageVisitors,
            single_page_visitors: totalVisitors - multiPageVisitors,
            top_entries:          topEntries,
            top_exits:            topExits,
            top_transitions:      topTransitions,
            top_paths:            topPaths
        });
    } catch (err) {
        logger.error("journey error:", err);
        res.status(500).json({ error: "failed to fetch journey data" });
    }
});

router.get("/api/attention-profile", requireAuth(), async (req, res) => {
    try {
        const account = await Account.findOne({ clerk_user_id: getAuth(req).userId }).lean();
        if (!account) return res.status(404).json({ error: "account not found" });

        const siteKey = resolveSiteKey(req, account);
        if (!siteKey) return res.status(403).json({ error: "website not available" });

        const page   = req.query.page || null;
        const result = await computeAttentionProfile(siteKey, page);

        res.json(result);
    } catch (err) {
        logger.error("attention profile error:", err);
        res.status(500).json({ error: "failed to generate attention profile" });
    }
});

module.exports = router;
