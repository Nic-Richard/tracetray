const express = require("express");
const router = express.Router();
const { getAuth } = require("@clerk/express");
const { requireAuth } = require("../middleware/auth");
const { Account, BugReport } = require("../db/models");
const { resolveSiteKey } = require("../lib/siteAccount");
const logger = require("../lib/logger");
const { sendAlert } = require("../lib/alerts");
const { rateLimit } = require("../lib/rateLimit");

const reportLimit = rateLimit({
    limit: 10,
    windowMs: 60 * 60 * 1000,
    key: (req) => getAuth(req).userId,
    message: "too many reports, try again in a little while",
});

router.post("/api/bug-reports", requireAuth(), reportLimit, async (req, res) => {
    try {
        const clerkUserId = getAuth(req).userId;
        const account = await Account.findOne({ clerk_user_id: clerkUserId });
        if (!account) return res.status(404).json({ error: "account not found" });

        const siteKey = resolveSiteKey(req, account);
        if (!siteKey) return res.status(403).json({ error: "website not available" });

        const description = String(req.body.description || "").trim();
        const allowedCategories = new Set(["bug", "account", "billing", "suggestion", "other"]);
        const category = allowedCategories.has(req.body.category) ? req.body.category : "bug";

        if (description.length < 10) {
            return res.status(400).json({ error: "please include a little more detail" });
        }

        if (description.length > 5000) {
            return res.status(400).json({ error: "report is too long" });
        }

        const report = await BugReport.create({
            account_id: account._id,
            clerk_user_id: clerkUserId,
            site_key: siteKey,
            email: account.email,
            category,
            description,
            dashboard_section: String(req.body.dashboard_section || "").slice(0, 100),
            page_url: String(req.body.page_url || "").slice(0, 1000),
            user_agent: String(req.headers["user-agent"] || "").slice(0, 1000)
        });

        sendAlert("bugs", {
            title: `${category[0].toUpperCase()}${category.slice(1)} report`,
            description: description.slice(0, 3000),
            url: /^https?:\/\//.test(report.page_url) ? report.page_url : "",
            fields: [
                { name: "Account", value: String(account._id) },
                { name: "Site", value: siteKey },
                { name: "Section", value: report.dashboard_section },
                { name: "Report", value: String(report._id) },
            ],
        });

        res.status(201).json({ id: report._id, created_at: report.created_at });
    } catch (err) {
        logger.error("bug report error:", err);
        res.status(500).json({ error: "could not save report" });
    }
});

module.exports = router;
