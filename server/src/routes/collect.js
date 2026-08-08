const express = require("express");
const router = express.Router();
const { Account, Session } = require("../db/models");
const { ensureAccountSites } = require("../lib/siteAccount");
const { normalizeTrackingDomain } = require("../lib/tracking");
const logger = require("../lib/logger");

router.post("/collect", async (req, res) => {
    try {
        const data = req.body || {};
        const siteKey = String(data.key || "").trim();
        const sessionId = String(data.session_id || "").trim();
        const originDomain = normalizeTrackingDomain(req.headers.origin);
        const pageDomain = normalizeTrackingDomain(data.page);
        const trackingDomain = originDomain || pageDomain;

        if (!siteKey || !sessionId || !trackingDomain) return res.sendStatus(204);
        if (originDomain && pageDomain && originDomain !== pageDomain) return res.sendStatus(204);

        let account = await Account.findOne({
            $or: [{ site_key: siteKey }, { "sites.key": siteKey }]
        });

        if (!account) return res.sendStatus(204);
        await ensureAccountSites(account);

        let site = account.sites.find(item => item.key === siteKey);
        if (!site) return res.sendStatus(204);

        if (!site.domain) {
            await Account.updateOne(
                {
                    _id: account._id,
                    sites: {
                        $elemMatch: {
                            key: siteKey,
                            $or: [
                                { domain: { $exists: false } },
                                { domain: null },
                                { domain: "" }
                            ]
                        }
                    }
                },
                {
                    $set: {
                        "sites.$.domain": trackingDomain,
                        "sites.$.url": `${new URL(req.headers.origin || data.page).protocol}//${new URL(req.headers.origin || data.page).host}`
                    }
                }
            );

            account = await Account.findById(account._id);
            site = account?.sites.find(item => item.key === siteKey);
        }

        if (!site || site.domain !== trackingDomain) return res.sendStatus(204);

        const isFinal = !!data.end_time;
        isFinal
            ? logger.debug(`final  key=${siteKey}  session=${sessionId}  duration=${data.summary?.duration_ms}ms`)
            : logger.debug(`batch  key=${siteKey}  session=${sessionId}  events=${data.events?.length}`);

        await Session.updateOne(
            { site_key: siteKey, session_id: sessionId },
            {
                $set: {
                    site_key: siteKey,
                    visitor_id: data.visitor_id || null,
                    device_type: data.device_type || "desktop",
                    referrer: data.referrer || null,
                    page: data.page,
                    start_time: data.start_time,
                    end_time: data.end_time,
                    summary: data.summary,
                    updated_at: Date.now()
                },
                $push: { events: { $each: Array.isArray(data.events) ? data.events : [] } }
            },
            { upsert: true }
        );

        res.sendStatus(200);
    } catch (err) {
        logger.error("collect error:", err);
        res.sendStatus(500);
    }
});

module.exports = router;
