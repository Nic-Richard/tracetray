const express = require("express");
const router = express.Router();
const { getAuth } = require("@clerk/express");
const { requireAuth } = require("../middleware/auth");
const { Account, PageDay, AnalysisResult } = require("../db/models");
const { resolveSiteKey, getAccountSites } = require("../lib/siteAccount");
const { groupShares } = require("../lib/groupShifts");
const { toCsv } = require("../lib/csv");
const { hasFeature } = require("../lib/limits");
const logger = require("../lib/logger");

const DAY_MS = 24 * 60 * 60 * 1000;

async function loadSite(req, res) {
    const account = await Account.findOne({ clerk_user_id: getAuth(req).userId }).lean();
    if (!account) { res.status(404).json({ error: "account not found" }); return null; }
    const siteKey = resolveSiteKey(req, account);
    const site = siteKey && getAccountSites(account).find(item => item.key === siteKey);
    if (!site) { res.status(403).json({ error: "website not available" }); return null; }
    if (!hasFeature(account, "csvExport")) {
        res.status(403).json({ error: "exports are part of Pro and Ultra", limit_reached: "plan" });
        return null;
    }
    return site;
}

function sendCsv(res, site, name, csv) {
    const slug = String(site.name || "site").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "site";
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="tracetray-${slug}-${name}.csv"`);
    res.send(csv);
}

router.get("/api/export/daily", requireAuth(), async (req, res) => {
    try {
        const site = await loadSite(req, res);
        if (!site) return;
        const days = [30, 90, 365].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
        const from = new Date(Date.now() - (days - 1) * DAY_MS).toISOString().slice(0, 10);
        const rows = await PageDay.find({ site_key: site.key, day: { $gte: from } }, { _id: 0, day: 1, page: 1, path: 1, sessions: 1, desktop: 1, mobile: 1, clicks: 1, goals: 1 })
            .sort({ day: 1, page: 1, path: 1 }).lean();
        // One column per goal: visits on that row that reached it.
        const goals = site.goals || [];
        sendCsv(res, site, `daily-${days}-days`, toCsv(
            ["day", "page", "address", "visits", "desktop", "phones", "clicks", ...goals.map(g => `reached: ${g.name}`)],
            rows.map(r => [r.day, r.page, r.path, r.sessions || 0, r.desktop || 0, r.mobile || 0, r.clicks || 0, ...goals.map(g => r.goals?.[g.id] || 0)])
        ));
    } catch (err) {
        logger.error("daily export error:", err);
        res.status(500).json({ error: "couldn't build the export" });
    }
});

router.get("/api/export/groups", requireAuth(), async (req, res) => {
    try {
        const site = await loadSite(req, res);
        if (!site) return;
        const latest = await AnalysisResult.aggregate([
            { $match: { site_key: site.key, k: { $gt: 0 } } },
            { $sort: { ran_at: -1 } },
            { $group: { _id: "$page", result: { $first: "$$ROOT" } } }
        ]);
        const rows = [];
        for (const { result } of latest.sort((a, b) => String(a._id).localeCompare(String(b._id)))) {
            for (const device of ["desktop", "mobile"]) {
                const clusters = (device === "mobile" ? result.mobile?.clusters : result.clusters) || [];
                const total = clusters.reduce((sum, c) => sum + (c.n || 0), 0);
                for (const g of groupShares(result, device) || []) {
                    rows.push([device === "mobile" ? "phones" : "desktop", result.page, new Date(result.ran_at).toISOString().slice(0, 10), g.group, Math.round(g.share * 1000) / 1000, Math.round(g.share * total)]);
                }
            }
        }
        sendCsv(res, site, "visitor-groups", toCsv(["device", "page", "analyzed", "group", "share", "visits"], rows));
    } catch (err) {
        logger.error("groups export error:", err);
        res.status(500).json({ error: "couldn't build the export" });
    }
});

module.exports = router;
