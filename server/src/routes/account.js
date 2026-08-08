const express = require("express");
const router = express.Router();
const { getAuth, clerkClient } = require("@clerk/express");
const { requireAuth } = require("../middleware/auth");
const { Account } = require("../db/models");
const { generateSiteKey, getSiteLimit, ensureAccountSites, deleteSiteData } = require("../lib/siteAccount");
const logger = require("../lib/logger");

router.post("/api/account", requireAuth(), async (req, res) => {
    try {
        const clerkUserId = getAuth(req).userId;
        const clerkUser   = await clerkClient.users.getUser(clerkUserId);
        const email       = clerkUser.emailAddresses[0]?.emailAddress || "";

        let account = await Account.findOne({ clerk_user_id: clerkUserId });

        if (!account) {
            const site_key = generateSiteKey();
            account = await Account.create({
                site_key,
                clerk_user_id: clerkUserId,
                email,
                site_url:   req.body.site_url || null,
                sites: [{
                    key: site_key,
                    name: req.body.site_name || req.body.site_url || "My website",
                    url: req.body.site_url || null,
                    domain: null,
                    created_at: new Date()
                }],
                plan:       "none",
                created_at: new Date()
            });
            logger.info(`new account  email=${email}  key=${site_key}`);
        }

        const sites = await ensureAccountSites(account);
        const host = `${req.protocol}://${req.get("host")}`;
        res.json({
            site_key:  sites[0].key,
            sites,
            site_limit: getSiteLimit(account),
            plan:      account.plan,
            dashboard: `${host}/dashboard.html`,
            snippet:   `<script>\n  window.TraceTray = { endpoint: "${host}/collect", key: "${sites[0].key}" };\n</script>\n<script src="${host}/client/tracker.js"></script>`
        });
    } catch (err) {
        logger.error("account error:", err);
        res.status(500).json({ error: "account setup failed" });
    }
});

router.get("/api/sites", requireAuth(), async (req, res) => {
    try {
        const account = await Account.findOne({ clerk_user_id: getAuth(req).userId });
        if (!account) return res.status(404).json({ error: "account not found" });
        const sites = await ensureAccountSites(account);
        res.json({ sites, limit: getSiteLimit(account) });
    } catch (err) {
        logger.error("sites error:", err);
        res.status(500).json({ error: "could not load websites" });
    }
});

router.post("/api/sites", requireAuth(), async (req, res) => {
    try {
        const account = await Account.findOne({ clerk_user_id: getAuth(req).userId });
        if (!account) return res.status(404).json({ error: "account not found" });

        const sites = await ensureAccountSites(account);
        const siteLimit = getSiteLimit(account);
        if (sites.length >= siteLimit) {
            return res.status(400).json({ error: `you can add up to ${siteLimit} website${siteLimit === 1 ? "" : "s"}` });
        }

        const name = String(req.body.name || "").trim().slice(0, 80);
        const url = String(req.body.url || "").trim().slice(0, 500) || null;
        if (!name) return res.status(400).json({ error: "website name is required" });

        let key;
        do { key = generateSiteKey(); } while (await Account.exists({ $or: [{ site_key: key }, { "sites.key": key }] }));

        const site = { key, name, url, domain: null, created_at: new Date() };
        account.sites.push(site);
        await account.save();
        res.status(201).json({ site, sites: account.sites, limit: siteLimit });
    } catch (err) {
        logger.error("create site error:", err);
        res.status(500).json({ error: "could not create website" });
    }
});

router.patch("/api/sites/:key", requireAuth(), async (req, res) => {
    try {
        const account = await Account.findOne({ clerk_user_id: getAuth(req).userId });
        if (!account) return res.status(404).json({ error: "account not found" });

        await ensureAccountSites(account);
        const site = account.sites.find(item => item.key === req.params.key);
        if (!site) return res.status(404).json({ error: "website not found" });

        const name = String(req.body.name || "").trim().slice(0, 80);
        if (!name) return res.status(400).json({ error: "website name is required" });

        site.name = name;
        await account.save();

        res.json({ site, sites: account.sites, limit: getSiteLimit(account) });
    } catch (err) {
        logger.error("rename site error:", err);
        res.status(500).json({ error: "could not rename website" });
    }
});

router.delete("/api/sites/:key", requireAuth(), async (req, res) => {
    try {
        const account = await Account.findOne({ clerk_user_id: getAuth(req).userId });
        if (!account) return res.status(404).json({ error: "account not found" });

        await ensureAccountSites(account);
        const siteKey = req.params.key;
        const siteIndex = account.sites.findIndex(item => item.key === siteKey);
        if (siteIndex < 0) return res.status(404).json({ error: "website not found" });

        const deleted = await deleteSiteData(siteKey);

        if (account.sites.length === 1) {
            let newKey;
            do {
                newKey = generateSiteKey();
            } while (await Account.exists({
                $or: [{ site_key: newKey }, { "sites.key": newKey }]
            }));

            account.sites = [{
                key: newKey,
                name: "My website",
                url: null,
                domain: null,
                refresh_day: null,
                page_refresh_count: 0,
                last_page_refresh_at: null,
                last_all_refresh_at: null,
                created_at: new Date()
            }];
            account.site_key = newKey;
            account.site_url = null;
            await account.save();

            return res.json({
                deleted: true,
                reset: true,
                deleted_sessions: deleted.sessions,
                deleted_analyses: deleted.analyses,
                deleted_reports: deleted.reports,
                sites: account.sites,
                limit: getSiteLimit(account)
            });
        }

        account.sites.splice(siteIndex, 1);
        if (account.site_key === siteKey) {
            account.site_key = account.sites[0].key;
            account.site_url = account.sites[0].url || null;
        }
        await account.save();

        res.json({
            deleted: true,
            reset: false,
            deleted_sessions: deleted.sessions,
            deleted_analyses: deleted.analyses,
            deleted_reports: deleted.reports,
            sites: account.sites,
            limit: getSiteLimit(account)
        });
    } catch (err) {
        logger.error("delete site error:", err);
        res.status(500).json({ error: "could not remove website" });
    }
});

module.exports = router;
