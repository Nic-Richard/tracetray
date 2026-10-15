const express = require("express");
const router = express.Router();
const { getAuth } = require("@clerk/express");
const { requireAuth } = require("../middleware/auth");
const { Account } = require("../db/models");
const { resolveSiteKey } = require("../lib/siteAccount");
const { hasFeature } = require("../lib/limits");
const { parsePath, pathFunnel } = require("../lib/paths");
const logger = require("../lib/logger");

const MAX_PATHS = 10;

async function loadSite(req, res) {
    const account = await Account.findOne({ clerk_user_id: getAuth(req).userId });
    if (!account) { res.status(404).json({ error: "account not found" }); return null; }
    const siteKey = resolveSiteKey(req, account);
    const site = siteKey && account.sites.find(item => item.key === siteKey);
    if (!site) { res.status(403).json({ error: "website not available" }); return null; }
    if (!hasFeature(account, "paths")) { res.status(403).json({ error: "expected paths are part of Ultra", limit_reached: "plan" }); return null; }
    return { account, site };
}

router.get("/api/paths", requireAuth(), async (req, res) => {
    try {
        const found = await loadSite(req, res);
        if (!found) return;
        const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
        const paths = found.site.paths || [];
        const funnels = [];
        for (const path of paths) funnels.push({ id: path.id, name: path.name, ...await pathFunnel(found.site.key, path.steps, { days }) });
        res.json({ paths: funnels, cap: MAX_PATHS });
    } catch (err) {
        logger.error("paths error:", err);
        res.status(500).json({ error: "couldn't load your paths" });
    }
});

router.post("/api/paths", requireAuth(), async (req, res) => {
    try {
        const found = await loadSite(req, res);
        if (!found) return;
        const paths = found.site.paths || [];
        if (paths.length >= MAX_PATHS) return res.status(400).json({ error: `you can keep ${MAX_PATHS} paths per website; remove one first` });
        const parsed = parsePath(req.body);
        if (parsed.error) return res.status(400).json({ error: parsed.error });
        found.site.paths = [...paths, { ...parsed.path, created_at: new Date() }];
        await found.account.save();
        res.status(201).json(parsed.path);
    } catch (err) {
        logger.error("add path error:", err);
        res.status(500).json({ error: "couldn't save the path" });
    }
});

router.delete("/api/paths/:id", requireAuth(), async (req, res) => {
    try {
        const found = await loadSite(req, res);
        if (!found) return;
        const paths = found.site.paths || [];
        if (!paths.some(p => p.id === req.params.id)) return res.status(404).json({ error: "that path isn't there" });
        found.site.paths = paths.filter(p => p.id !== req.params.id);
        await found.account.save();
        res.json({ deleted: true });
    } catch (err) {
        logger.error("delete path error:", err);
        res.status(500).json({ error: "couldn't remove the path" });
    }
});

module.exports = router;
