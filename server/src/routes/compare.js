const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const { getAuth } = require("@clerk/express");
const { requireAuth } = require("../middleware/auth");
const { Account } = require("../db/models");
const { resolveSiteKey } = require("../lib/siteAccount");
const { compareAroundChange } = require("../lib/compare");
const { mainGoalFor } = require("../lib/goalHits");
const { isPageLocked } = require("../lib/limits");
const { planLimits } = require("../lib/plans");
const { TRACETRAY_MODE } = require("../config");
const logger = require("../lib/logger");

const MAX_CHANGES_PER_SITE = 200;

async function loadSite(req, res) {
    const account = await Account.findOne({ clerk_user_id: getAuth(req).userId });
    if (!account) { res.status(404).json({ error: "account not found" }); return null; }
    const siteKey = resolveSiteKey(req, account);
    const site = siteKey && account.sites.find(item => item.key === siteKey);
    if (!site) { res.status(403).json({ error: "website not available" }); return null; }
    if (TRACETRAY_MODE === "production" && !planLimits(account.plan)) {
        res.status(403).json({ error: "before-and-after comparisons need a plan", limit_reached: "plan" });
        return null;
    }
    return { account, site };
}

const isDay = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));

router.get("/api/page-changes", requireAuth(), async (req, res) => {
    try {
        const found = await loadSite(req, res);
        if (!found) return;
        const page = String(req.query.page || "");
        const changes = (found.site.page_changes || []).filter(c => c.page === page)
            .sort((a, b) => b.day.localeCompare(a.day))
            .map(c => ({ id: c.id, day: c.day, note: c.note }));
        res.json(changes);
    } catch (err) {
        logger.error("page changes error:", err);
        res.status(500).json({ error: "couldn't load the changes" });
    }
});

router.post("/api/page-changes", requireAuth(), async (req, res) => {
    try {
        const found = await loadSite(req, res);
        if (!found) return;
        const page = String(req.body.page || "").slice(0, 2000);
        const day = req.body.day;
        const note = String(req.body.note || "").trim().slice(0, 120);
        if (!page) return res.status(400).json({ error: "pick a page first" });
        if (!isDay(day)) return res.status(400).json({ error: "pick the day you made the change" });
        if (day > new Date().toISOString().slice(0, 10)) return res.status(400).json({ error: "the change can't be in the future" });
        const changes = found.site.page_changes || [];
        if (changes.length >= MAX_CHANGES_PER_SITE) return res.status(400).json({ error: "remove an old change first" });
        const change = { id: crypto.randomBytes(6).toString("base64url"), page, day, note, created_at: new Date() };
        found.site.page_changes = [...changes, change];
        await found.account.save();
        res.status(201).json({ id: change.id, day, note });
    } catch (err) {
        logger.error("add page change error:", err);
        res.status(500).json({ error: "couldn't save the change" });
    }
});

router.delete("/api/page-changes/:id", requireAuth(), async (req, res) => {
    try {
        const found = await loadSite(req, res);
        if (!found) return;
        const changes = found.site.page_changes || [];
        if (!changes.some(c => c.id === req.params.id)) return res.status(404).json({ error: "that change isn't there" });
        found.site.page_changes = changes.filter(c => c.id !== req.params.id);
        await found.account.save();
        res.json({ deleted: true });
    } catch (err) {
        logger.error("delete page change error:", err);
        res.status(500).json({ error: "couldn't remove the change" });
    }
});

router.get("/api/compare", requireAuth(), async (req, res) => {
    try {
        const found = await loadSite(req, res);
        if (!found) return;
        const page = String(req.query.page || "");
        if (!page || !isDay(req.query.day)) return res.status(400).json({ error: "pick a page and a day" });
        if (await isPageLocked(found.account, found.site.key, page)) {
            return res.status(403).json({ error: "this page is past your plan's page limit for this month", limit_reached: "pages" });
        }
        res.json(await compareAroundChange(found.site.key, page, req.query.day, Date.now(), await mainGoalFor(found.site.key, page)));
    } catch (err) {
        logger.error("compare error:", err);
        res.status(500).json({ error: "couldn't compare that change" });
    }
});

// Wins: marked changes after which the page's goal rate clearly rose. Newest first; only the latest 50 changes are checked.
router.get("/api/wins", requireAuth(), async (req, res) => {
    try {
        const found = await loadSite(req, res);
        if (!found) return;
        const changes = [...(found.site.page_changes || [])].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 50);
        const wins = [];
        for (const change of changes) {
            const goal = await mainGoalFor(found.site.key, change.page);
            if (!goal) continue;
            const result = await compareAroundChange(found.site.key, change.page, change.day, Date.now(), goal);
            if (result.goal?.verdict === "better") {
                wins.push({ id: change.id, page: change.page, day: change.day, note: change.note, goal: goal.name, before: result.goal.before, after: result.goal.after });
            }
        }
        res.json(wins);
    } catch (err) {
        logger.error("wins error:", err);
        res.status(500).json({ error: "couldn't load your wins" });
    }
});

module.exports = router;
