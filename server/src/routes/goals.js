const express = require("express");
const router = express.Router();
const { getAuth } = require("@clerk/express");
const { requireAuth } = require("../middleware/auth");
const { Account, PageDay } = require("../db/models");
const { resolveSiteKey } = require("../lib/siteAccount");
const { limitsFor } = require("../lib/limits");
const { PLANS } = require("../lib/plans");
const { parseGoal, matchChanged, appliesTo, isGoalPage } = require("../lib/goals");
const { queueBackfill, removeGoalMarks, goalRate, goalWeeks, mainGoalFor } = require("../lib/goalHits");
const logger = require("../lib/logger");

const DAY_MS = 24 * 60 * 60 * 1000;

async function loadSite(req, res) {
    const account = await Account.findOne({ clerk_user_id: getAuth(req).userId });
    if (!account) { res.status(404).json({ error: "account not found" }); return null; }
    const siteKey = resolveSiteKey(req, account);
    const site = siteKey && account.sites.find(item => item.key === siteKey);
    if (!site) { res.status(403).json({ error: "website not available" }); return null; }
    return { account, site };
}

// Plans cap goals per website; the beta allows Ultra's number.
const goalCap = account => limitsFor(account)?.goals ?? PLANS.ultra.goals;

const view = goal => ({ id: goal.id, name: goal.name, type: goal.type, match: goal.match, pages: goal.pages || [], target: goal.target ?? null, backfill: goal.backfill || "done" });

router.get("/api/goals", requireAuth(), async (req, res) => {
    try {
        const found = await loadSite(req, res);
        if (!found) return;
        const goals = found.site.goals || [];
        const since = new Date(Date.now() - 6 * DAY_MS).toISOString().slice(0, 10);
        const rows = goals.length
            ? await PageDay.find({ site_key: found.site.key, day: { $gte: since }, goals: { $exists: true } }, { _id: 0, goals: 1 }).lean()
            : [];
        const lastWeek = id => rows.reduce((n, row) => n + (row.goals?.[id] || 0), 0);
        res.json({
            goals: goals.map(goal => ({ ...view(goal), reached_last_7_days: lastWeek(goal.id) })),
            main_goals: found.site.main_goals || [],
            cap: goalCap(found.account)
        });
    } catch (err) {
        logger.error("goals error:", err);
        res.status(500).json({ error: "couldn't load your goals" });
    }
});

router.post("/api/goals", requireAuth(), async (req, res) => {
    try {
        const found = await loadSite(req, res);
        if (!found) return;
        const goals = found.site.goals || [];
        const cap = goalCap(found.account);
        if (goals.length >= cap) return res.status(400).json({ error: `your plan allows ${cap} goals per website; remove one or upgrade`, limit_reached: "goals" });
        const parsed = parseGoal(req.body);
        if (parsed.error) return res.status(400).json({ error: parsed.error });
        const goal = { ...parsed.goal, backfill: "queued", created_at: new Date() };
        found.site.goals = [...goals, goal];
        await found.account.save();
        queueBackfill(found.site.key, goal);
        res.status(201).json(view(goal));
    } catch (err) {
        logger.error("add goal error:", err);
        res.status(500).json({ error: "couldn't save the goal" });
    }
});

router.patch("/api/goals/:id", requireAuth(), async (req, res) => {
    try {
        const found = await loadSite(req, res);
        if (!found) return;
        const goals = found.site.goals || [];
        const existing = goals.find(g => g.id === req.params.id);
        if (!existing) return res.status(404).json({ error: "that goal isn't there" });
        const before = existing.toObject ? existing.toObject() : existing;
        const parsed = parseGoal({ name: req.body.name ?? before.name, match: req.body.match, pages: req.body.pages, ...("target" in req.body ? { target: req.body.target } : {}) }, before);
        if (parsed.error) return res.status(400).json({ error: parsed.error });
        const recheck = matchChanged(before, parsed.goal);
        const goal = { ...before, ...parsed.goal, ...(recheck ? { backfill: "queued" } : {}) };
        found.site.goals = goals.map(g => g.id === goal.id ? goal : g);
        await found.account.save();
        if (recheck) queueBackfill(found.site.key, goal);
        res.json(view(goal));
    } catch (err) {
        logger.error("edit goal error:", err);
        res.status(500).json({ error: "couldn't save the goal" });
    }
});

router.delete("/api/goals/:id", requireAuth(), async (req, res) => {
    try {
        const found = await loadSite(req, res);
        if (!found) return;
        const goals = found.site.goals || [];
        if (!goals.some(g => g.id === req.params.id)) return res.status(404).json({ error: "that goal isn't there" });
        found.site.goals = goals.filter(g => g.id !== req.params.id);
        found.site.main_goals = (found.site.main_goals || []).filter(m => m.goal !== req.params.id);
        await found.account.save();
        removeGoalMarks(found.site.key, req.params.id).catch(err => logger.error("remove goal marks error:", err));
        res.json({ deleted: true });
    } catch (err) {
        logger.error("delete goal error:", err);
        res.status(500).json({ error: "couldn't remove the goal" });
    }
});

// The goal a page's header and before-and-after use; null clears it.
router.put("/api/main-goal", requireAuth(), async (req, res) => {
    try {
        const found = await loadSite(req, res);
        if (!found) return;
        const page = String(req.body.page || "").slice(0, 2000);
        const goalId = req.body.goal ? String(req.body.goal) : null;
        if (!page) return res.status(400).json({ error: "pick a page first" });
        if (goalId && !(found.site.goals || []).some(g => g.id === goalId)) return res.status(404).json({ error: "that goal isn't there" });
        const others = (found.site.main_goals || []).filter(m => m.page !== page);
        found.site.main_goals = goalId ? [...others, { page, goal: goalId }] : others;
        await found.account.save();
        res.json({ page, goal: goalId });
    } catch (err) {
        logger.error("main goal error:", err);
        res.status(500).json({ error: "couldn't save the main goal" });
    }
});

// The goals that apply to a page and how often each was reached; the main goal comes first.
router.get("/api/goal-rates", requireAuth(), async (req, res) => {
    try {
        const found = await loadSite(req, res);
        if (!found) return;
        const page = String(req.query.page || "");
        if (!page) return res.status(400).json({ error: "pick a page first" });
        const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
        const session = { page };
        const goals = (found.site.goals || []).filter(g => appliesTo(g, session) && !isGoalPage(g, session));
        const main = (found.site.main_goals || []).find(m => m.page === page)?.goal;
        goals.sort((a, b) => (b.id === main) - (a.id === main));
        const rates = await Promise.all(goals.map(async goal => ({ ...view(goal), main: goal.id === main, ...await goalRate(found.site.key, goal, { page, days }) })));
        res.json({ page, days, goals: rates });
    } catch (err) {
        logger.error("goal rates error:", err);
        res.status(500).json({ error: "couldn't load goal rates" });
    }
});

// Twelve weeks of the page's main goal rate and its best full week.
router.get("/api/goal-trend", requireAuth(), async (req, res) => {
    try {
        const found = await loadSite(req, res);
        if (!found) return;
        const page = String(req.query.page || "");
        if (!page) return res.status(400).json({ error: "pick a page first" });
        const goal = await mainGoalFor(found.site.key, page);
        if (!goal) return res.json({ goal: null, weeks: [], best: null });
        res.json({ goal: view(goal), ...await goalWeeks(found.site.key, goal, { page }) });
    } catch (err) {
        logger.error("goal trend error:", err);
        res.status(500).json({ error: "couldn't load the goal trend" });
    }
});

module.exports = router;
