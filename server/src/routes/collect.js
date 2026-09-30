const express = require("express");
const router = express.Router();
const { Account, Session } = require("../db/models");
const { ensureAccountSites } = require("../lib/siteAccount");
const { normalizeTrackingDomain } = require("../lib/tracking");
const logger = require("../lib/logger");

const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 240;
const MAX_BATCH_EVENTS = 2000;
const MAX_SESSION_EVENTS = 30000;
const requestsByIp = new Map();

function overRateLimit(ip) {
    const now = Date.now();
    if (requestsByIp.size > 50000) {
        for (const [key, entry] of requestsByIp) if (entry.resetAt <= now) requestsByIp.delete(key);
    }
    const entry = requestsByIp.get(ip);
    if (!entry || entry.resetAt <= now) {
        requestsByIp.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
        return false;
    }
    entry.count += 1;
    return entry.count > RATE_LIMIT;
}

function text(value, max) {
    return typeof value === "string" ? value.slice(0, max) : null;
}

router.post("/collect", async (req, res) => {
    try {
        if (overRateLimit(req.ip)) return res.sendStatus(429);

        const data = req.body || {};
        const siteKey = String(data.key || "").trim().slice(0, 64);
        const sessionId = String(data.session_id || "").trim().slice(0, 100);
        const events = Array.isArray(data.events) ? data.events.slice(0, MAX_BATCH_EVENTS) : [];
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
                    visitor_id: text(data.visitor_id, 100),
                    device_type: data.device_type === "mobile" ? "mobile" : "desktop",
                    referrer: text(data.referrer, 2000),
                    page: text(data.page, 2000),
                    start_time: data.start_time,
                    end_time: data.end_time,
                    summary: data.summary,
                    updated_at: Date.now()
                },
                // A positive $slice keeps a session's first events and drops anything past the cap.
                $push: { events: { $each: events, $slice: MAX_SESSION_EVENTS } }
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
