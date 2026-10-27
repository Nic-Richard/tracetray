const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const { getAuth } = require("@clerk/express");
const { requireAuth } = require("../middleware/auth");
const { Account, AnalysisResult } = require("../db/models");
const { resolveSiteKey } = require("../lib/siteAccount");
const { compareAroundChange } = require("../lib/compare");
const { mainGoalFor } = require("../lib/goalHits");
const { findingSnapshot, goalSnapshot, goalForChange } = require("../lib/changeFinding");
const { isPageLocked } = require("../lib/limits");
const { planLimits } = require("../lib/plans");
const logger = require("../lib/logger");

const MAX_CHANGES_PER_SITE = 200;

async function loadSite(req, res) {
    const account = await Account.findOne({ clerk_user_id: getAuth(req).userId });
    if (!account) { res.status(404).json({ error: "account not found" }); return null; }
    const siteKey = resolveSiteKey(req, account);
    const site = siteKey && account.sites.find(item => item.key === siteKey);
    if (!site) { res.status(403).json({ error: "website not available" }); return null; }
    if (!planLimits(account.plan)) {
        res.status(403).json({ error: "before-and-after comparisons need a plan", limit_reached: "plan" });
        return null;
    }
    return { account, site };
}

const isDay = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

const changeView = c => ({ id: c.id, day: c.day, note: c.note, finding: c.finding || null, goal_snapshot: c.goal_snapshot || null });

async function sourceFor(site, page, reference) {
    if (!reference || typeof reference.ran_at !== "string" || !Number.isFinite(Date.parse(reference.ran_at))
        || !["desktop", "mobile"].includes(reference.device) || typeof reference.action !== "string"
        || reference.action.length > 4000 || typeof reference.group !== "string" || reference.group.length > 500) return null;
    const analysis = await AnalysisResult.findOne({ site_key: site.key, page, ran_at: new Date(reference.ran_at) }).lean();
    const finding = findingSnapshot(analysis, reference);
    return finding ? { analysis, finding } : null;
}

router.get("/api/change-finding", requireAuth(), async (req, res) => {
    try {
        const found = await loadSite(req, res);
        if (!found) return;
        const page = String(req.query.page || "");
        if (await isPageLocked(found.account, found.site.key, page)) return res.status(403).json({ error: "this page is past your plan's page limit" });
        const source = await sourceFor(found.site, page, req.query);
        if (!source) return res.status(400).json({ error: "That finding isn't available. Reopen it from the page's analysis." });
        res.json(source.finding);
    } catch (err) {
        logger.error("change finding error:", err);
        res.status(500).json({ error: "couldn't load that finding" });
    }
});

router.get("/api/page-changes", requireAuth(), async (req, res) => {
    try {
        const found = await loadSite(req, res);
        if (!found) return;
        const page = String(req.query.page || "");
        const changes = (found.site.page_changes || []).filter(c => c.page === page)
            .sort((a, b) => b.day.localeCompare(a.day))
            .map(changeView);
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
        if (await isPageLocked(found.account, found.site.key, page)) return res.status(403).json({ error: "this page is past your plan's page limit" });
        if (!isDay(day)) return res.status(400).json({ error: "pick the day you made the change" });
        if (day > new Date().toISOString().slice(0, 10)) return res.status(400).json({ error: "the change can't be in the future" });
        const changes = found.site.page_changes || [];
        if (changes.length >= MAX_CHANGES_PER_SITE) return res.status(400).json({ error: "remove an old change first" });
        const source = req.body.source ? await sourceFor(found.site, page, req.body.source) : null;
        if (req.body.source && !source) return res.status(400).json({ error: "That finding isn't available. Reopen it from the page's analysis." });
        if (source && !note) return res.status(400).json({ error: "Describe what you actually changed before recording it." });
        if (source && day < source.finding.ran_at.slice(0, 10)) return res.status(400).json({ error: "The change must be on or after the finding's analysis day." });
        const goal = source ? (found.site.goals || []).find(g => g.id === source.analysis.goal?.id) || null
            : await mainGoalFor(found.site.key, page);
        if (source?.analysis.goal && (!goal || goal.backfill && goal.backfill !== "done"
            || goal.backfill_at && new Date(goal.backfill_at) > new Date(source.analysis.ran_at))) {
            return res.status(400).json({ error: "The goal changed or is being recounted. Refresh the analysis after the recount finishes." });
        }
        const change = { id: crypto.randomBytes(6).toString("base64url"), page, day, note, created_at: new Date(),
            finding: source?.finding || null, goal_snapshot: goalSnapshot(goal), comparison_version: 2 };
        found.site.page_changes = [...changes, change];
        await found.account.save();
        res.status(201).json(changeView(change));
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
        const change = req.query.change ? (found.site.page_changes || []).find(c => c.id === req.query.change && c.page === page) : null;
        if (req.query.change && !change) return res.status(404).json({ error: "that change isn't there" });
        const pinned = change?.comparison_version === 2 ? goalForChange(found.site, change)
            : { goal: await mainGoalFor(found.site.key, page), goal_status: "legacy" };
        res.json({ ...await compareAroundChange(found.site.key, page, change?.day || req.query.day, Date.now(), pinned.goal, change?.finding?.device),
            goal_status: pinned.goal_status });
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
            const goal = change.comparison_version === 2 ? goalForChange(found.site, change).goal : await mainGoalFor(found.site.key, change.page);
            if (!goal) continue;
            const result = await compareAroundChange(found.site.key, change.page, change.day, Date.now(), goal, change.finding?.device);
            if (result.goal?.verdict === "better") {
                wins.push({ id: change.id, page: change.page, day: change.day, note: change.note, goal: goal.name, before: result.goal.before, after: result.goal.after,
                    days: result.days, device: result.device, before_visits: result.before.visits, after_visits: result.after.visits });
            }
        }
        res.json(wins);
    } catch (err) {
        logger.error("wins error:", err);
        res.status(500).json({ error: "couldn't load your wins" });
    }
});

module.exports = router;
