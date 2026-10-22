const express = require("express");
const router = express.Router();
const { getAuth } = require("@clerk/express");
const { requireAuth } = require("../middleware/auth");
const { Account } = require("../db/models");
const { resolveSiteKey } = require("../lib/siteAccount");
const { runAnalysis } = require("../lib/runAnalysis");
const {
    analysisRunning,
    PAGE_REFRESHES_PER_DAY,
    PAGE_REFRESH_COOLDOWN_MS,
    ALL_REFRESH_COOLDOWN_MS,
    utcDayKey,
    createAnalysisPermit,
    consumeAnalysisPermit
} = require("../lib/analysisState");
const { isPageLocked } = require("../lib/limits");
const logger = require("../lib/logger");

router.post("/api/analysis-permit", requireAuth(), async (req, res) => {
    try {
        const userId = getAuth(req).userId;
        const account = await Account.findOne({ clerk_user_id: userId });
        if (!account) return res.status(404).json({ error: "account not found" });

        const siteKey = resolveSiteKey(req, account);
        if (!siteKey) return res.status(403).json({ error: "website not available" });
        if (account.plan === "none") {
            return res.status(403).json({ error: "active subscription required" });
        }

        const site = account.sites.find(item => item.key === siteKey);
        if (!site) return res.status(404).json({ error: "website not found" });

        const scope = req.body.scope === "all" ? "all" : "page";
        const now = new Date();
        const nowMs = now.getTime();

        if (scope === "all") {
            const lastAll = site.last_all_refresh_at
                ? new Date(site.last_all_refresh_at).getTime()
                : 0;
            const remainingMs = ALL_REFRESH_COOLDOWN_MS - (nowMs - lastAll);

            if (remainingMs > 0) {
                return res.status(429).json({
                    error: "refresh all pages is available once per hour",
                    cooldown_remaining_ms: remainingMs
                });
            }

            const pageCount = Math.max(1, Math.min(100, Number(req.body.page_count) || 1));
            site.last_all_refresh_at = now;
            await account.save();

            return res.json({
                permit_token: createAnalysisPermit(userId, siteKey, "all", pageCount),
                scope,
                remaining_free_today: Math.max(0, PAGE_REFRESHES_PER_DAY - (site.page_refresh_count || 0))
            });
        }

        const today = utcDayKey(now);
        if (site.refresh_day !== today) {
            site.refresh_day = today;
            site.page_refresh_count = 0;
            site.last_page_refresh_at = null;
        }

        const usedToday = site.page_refresh_count || 0;
        if (usedToday >= PAGE_REFRESHES_PER_DAY) {
            const lastPage = site.last_page_refresh_at
                ? new Date(site.last_page_refresh_at).getTime()
                : 0;
            const remainingMs = PAGE_REFRESH_COOLDOWN_MS - (nowMs - lastPage);

            if (remainingMs > 0) {
                return res.status(429).json({
                    error: "next page refresh is not ready yet",
                    cooldown_remaining_ms: remainingMs,
                    remaining_free_today: 0
                });
            }
        }

        site.page_refresh_count = usedToday + 1;
        site.last_page_refresh_at = now;
        await account.save();

        res.json({
            permit_token: createAnalysisPermit(userId, siteKey, "page", 1),
            scope,
            remaining_free_today: Math.max(0, PAGE_REFRESHES_PER_DAY - site.page_refresh_count)
        });
    } catch (err) {
        logger.error("analysis permit error:", err);
        res.status(500).json({ error: "could not start refresh" });
    }
});

router.post("/api/run-analysis", requireAuth(), async (req, res) => {
    let account;
    try {
        account = await Account.findOne({ clerk_user_id: getAuth(req).userId }).lean();
    } catch (err) {
        logger.error("run analysis error:", err);
        return res.status(500).json({ error: "could not start analysis" });
    }
    if (!account) return res.status(404).json({ error: "account not found" });

    const siteKey = resolveSiteKey(req, account);
    if (!siteKey) return res.status(403).json({ error: "website not available" });

    if (account.plan === "none") return res.status(403).json({ error: "active subscription required" });

    if (analysisRunning[siteKey]) return res.status(409).json({ error: "analysis already running" });

    const permitToken = String(req.body?.permit_token || "");
    if (!consumeAnalysisPermit(permitToken, getAuth(req).userId, siteKey)) {
        return res.status(429).json({ error: "refresh permission expired; try again" });
    }

    const pageFilter = typeof req.body?.page === "string" && req.body.page ? req.body.page.slice(0, 2000) : null;
    if (pageFilter && await isPageLocked(account, siteKey, pageFilter)) {
        return res.status(403).json({ error: "this page is past your plan's page limit for this month", limit_reached: "pages" });
    }

    try {
        const result = await runAnalysis(siteKey, pageFilter);
        res.json({ ok: true, result });
    } catch (err) {
        if (err.code === "BUSY") return res.status(409).json({ error: "analysis already running" });
        logger.error("analysis error:", err);
        if (!res.headersSent) res.status(500).json({ error: "analysis failed" });
    }
});

module.exports = router;
