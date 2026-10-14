const express = require("express");
const router = express.Router();
const { getAuth } = require("@clerk/express");
const { requireAuth } = require("../middleware/auth");
const { Account, Session, AnalysisResult } = require("../db/models");
const { getSessionCounts, latestAnalysis, getTimeseries, getUxTrends, getPages, getJourney } = require("../lib/siteData");
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
        const counts = await getSessionCounts(siteKey, page);
        const lastResult = await latestAnalysis(siteKey, page);

        const clickSummary = lastResult
            ? await getClickSummary(siteKey, page, 15)
            : [];

        res.json({
            total_sessions:          counts.total,
            analysable_sessions:     counts.analysable,
            site_analysable_sessions: counts.siteAnalysable,
            desktop_sessions:        counts.desktop,
            mobile_sessions:         counts.mobile,
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

        const days = Math.min(parseInt(req.query.days) || 14, 90);
        res.json(await getTimeseries(siteKey, { days, page: req.query.page || null }));
    } catch (err) {
        logger.error("timeseries error:", err);
        res.status(500).json({ error: "failed to fetch session trend" });
    }
});

router.get("/api/ux-trends", requireAuth(), async (req, res) => {
    try {
        const account = await Account.findOne({ clerk_user_id: getAuth(req).userId }).lean();
        if (!account) return res.status(404).json({ error: "account not found" });

        const siteKey = resolveSiteKey(req, account);
        if (!siteKey) return res.status(403).json({ error: "website not available" });

        const runs = Math.min(parseInt(req.query.runs) || 10, 30);
        res.json(await getUxTrends(siteKey, { page: req.query.page || "all", runs }));
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

        res.json(await getPages(siteKey));
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

        res.json(await getJourney(siteKey));
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
