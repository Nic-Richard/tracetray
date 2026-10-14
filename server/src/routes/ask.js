const express = require("express");
const router = express.Router();
const { getAuth } = require("@clerk/express");
const { requireAuth } = require("../middleware/auth");
const { Account } = require("../db/models");
const { resolveSiteKey, getAccountSites } = require("../lib/siteAccount");
const { askAnalytics, ASK_MODEL } = require("../lib/askAnalytics");
const { rateLimit } = require("../lib/rateLimit");
const { TRACETRAY_MODE } = require("../config");
const { recordAskQuestion } = require("../lib/usage");
const logger = require("../lib/logger");

const DAY_MS = 24 * 60 * 60 * 1000;

const userLimit = rateLimit({
    limit: 20,
    windowMs: DAY_MS,
    key: (req) => getAuth(req).userId,
    message: "you've asked 20 questions today, try again tomorrow",
});

// Caps total spend across every account, whatever the per-user limits allow.
const siteWideLimit = rateLimit({
    limit: Number(process.env.ASK_DAILY_LIMIT) || 100,
    windowMs: DAY_MS,
    key: () => "all",
    message: "questions are busy right now, try again later",
});

router.post("/api/ask", requireAuth(), userLimit, siteWideLimit, async (req, res) => {
    try {
        const account = await Account.findOne({ clerk_user_id: getAuth(req).userId }).lean();
        if (!account) return res.status(404).json({ error: "account not found" });

        const siteKey = resolveSiteKey(req, account);
        if (!siteKey) return res.status(403).json({ error: "website not available" });
        if (TRACETRAY_MODE === "production" && account.plan === "none") {
            return res.status(403).json({ error: "active subscription required" });
        }

        const question = String(req.body.question || "").trim();
        if (question.length < 3) return res.status(400).json({ error: "type a question first" });
        if (question.length > 500) return res.status(400).json({ error: "keep the question under 500 characters" });

        const site = getAccountSites(account).find(item => item.key === siteKey);
        let siteHost = site?.domain || null;
        if (!siteHost && site?.url) {
            try { siteHost = new URL(site.url).hostname.replace(/^www\./, ""); } catch {}
        }
        const { answer, toolsUsed, usage } = await askAnalytics({
            siteKey,
            siteName: site?.name || site?.url,
            siteHost,
            question,
            history: req.body.history
        });

        await recordAskQuestion(account._id);
        logger.info(`ask ${siteKey}: ${toolsUsed.length} lookups, ${usage.input_tokens} in / ${usage.cache_read_input_tokens} cached / ${usage.output_tokens} out on ${ASK_MODEL}`);
        res.json({ answer, lookups: [...new Set(toolsUsed)] });
    } catch (err) {
        if (err.code === "AI_UNAVAILABLE") return res.status(503).json({ error: "questions aren't available right now" });
        logger.error("ask error:", err);
        res.status(502).json({ error: "couldn't answer that just now, try again in a minute" });
    }
});

module.exports = router;
