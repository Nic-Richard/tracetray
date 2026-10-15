const express = require("express");
const router = express.Router();
const { getAuth } = require("@clerk/express");
const { requireAuth } = require("../middleware/auth");
const { Account } = require("../db/models");
const { resolveSiteKey } = require("../lib/siteAccount");
const { parseRule, suggestRules, isGroup, MAX_RULES } = require("../lib/pageGroups");
const { pageMembers, knownPaths, regroupSite } = require("../lib/pageDays");
const { hasFeature } = require("../lib/limits");
const logger = require("../lib/logger");

const PREVIEW_ROWS = 10;
const regrouping = new Set();

async function loadSite(req, res) {
    const account = await Account.findOne({ clerk_user_id: getAuth(req).userId });
    if (!account) { res.status(404).json({ error: "account not found" }); return null; }
    const siteKey = resolveSiteKey(req, account);
    const site = siteKey && account.sites.find(item => item.key === siteKey);
    if (!site) { res.status(403).json({ error: "website not available" }); return null; }
    return { account, site, siteKey };
}

router.get("/api/page-groups", requireAuth(), async (req, res) => {
    try {
        const found = await loadSite(req, res);
        if (!found) return;
        const rules = found.site.page_groups || [];
        res.json({
            rules,
            suggestions: suggestRules(await knownPaths(found.siteKey), rules).slice(0, 20),
            regrouping: regrouping.has(found.siteKey)
        });
    } catch (err) {
        logger.error("page groups error:", err);
        res.status(500).json({ error: "could not load page groups" });
    }
});

router.put("/api/page-groups", requireAuth(), async (req, res) => {
    try {
        const found = await loadSite(req, res);
        if (!found) return;
        const { account, site, siteKey } = found;
        if (regrouping.has(siteKey)) return res.status(409).json({ error: "pages are still being regrouped, try again in a minute" });

        const input = Array.isArray(req.body?.rules) ? req.body.rules : [];
        if (input.length > MAX_RULES) return res.status(400).json({ error: `keep it to ${MAX_RULES} patterns` });
        const rules = [];
        for (const raw of input) {
            const rule = parseRule(raw);
            if (!rule) return res.status(400).json({ error: `"${String(raw).slice(0, 80)}" isn't a valid pattern. Use a path like /products/:product` });
            if (!rules.includes(rule.pattern)) rules.push(rule.pattern);
        }

        site.page_groups = rules;
        site.regrouping_at = new Date();
        await account.save();

        regrouping.add(siteKey);
        regroupSite(siteKey, rules)
            .catch(err => logger.error("regroup error:", err))
            .finally(() => regrouping.delete(siteKey));

        res.json({ rules, regrouping: true });
    } catch (err) {
        logger.error("save page groups error:", err);
        res.status(500).json({ error: "could not save page groups" });
    }
});

router.get("/api/pages/members", requireAuth(), async (req, res) => {
    try {
        const found = await loadSite(req, res);
        if (!found) return;
        const page = String(req.query.page || "");
        if (!isGroup(page)) return res.status(400).json({ error: "choose a page group" });

        // The full searchable list is a paid feature; everyone sees the busiest pages.
        const full = hasFeature(found.account, "fullGroupSearch");
        const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : null;
        const result = await pageMembers(found.siteKey, page, {
            q:      full ? String(req.query.q || "").trim() : "",
            sort:   String(req.query.sort || "sessions"),
            offset: full ? Math.max(0, parseInt(req.query.offset) || 0) : 0,
            limit:  full ? Math.min(100, Math.max(1, parseInt(req.query.limit) || 25)) : PREVIEW_ROWS,
            days
        });
        res.json({ ...result, limited: !full });
    } catch (err) {
        logger.error("page members error:", err);
        res.status(500).json({ error: "could not load pages in this group" });
    }
});

module.exports = router;
