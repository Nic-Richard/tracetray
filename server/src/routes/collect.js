const express = require("express");
const router = express.Router();
const { Account, Session } = require("../db/models");
const { ensureAccountSites } = require("../lib/siteAccount");
const { normalizeTrackingDomain } = require("../lib/tracking");
const logger = require("../lib/logger");
const { groupPage } = require("../lib/pageGroups");
const { countSession } = require("../lib/pageDays");
const { overVisitAllowance } = require("../lib/limits");
const { detailRate, inSample } = require("../lib/sampling");
const { markBatch } = require("../lib/goalHits");
const { TRACETRAY_MODE } = require("../config");
const { visitorIdFor } = require("../lib/visitorId");

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

        const { page, path } = groupPage(text(data.page, 2000), site.page_groups || []);
        const deviceType = data.device_type === "mobile" ? "mobile" : "desktop";

        // In production an account with no plan only keeps collecting during its 30-day hold.
        if (TRACETRAY_MODE === "production" && account.plan === "none" && !account.delete_after) return res.sendStatus(204);

        // Past the plan's monthly visits a visit keeps its summary but not its raw events. Busy pages keep
        // full detail for a sample of visits; the rest keep only clicks and taps, which goals need.
        const overAllowance = await overVisitAllowance(account);
        const detailed = !overAllowance && inSample(sessionId, await detailRate(account, siteKey, page));
        const keptEvents = overAllowance ? [] : detailed ? events : events.filter(e => e?.type === "click" || e?.type === "tap");

        // Worked out here rather than sent by the tracker, which stores nothing on the visitor's device.
        // A visit keeps the ID from its first batch, even if it runs past midnight.
        const visitorId = await visitorIdFor({ siteKey, ip: req.ip, userAgent: req.get("user-agent") });

        // Kept outside the raw events so it outlives them (they're trimmed after RAW_EVENT_RETENTION_DAYS).
        const depths = events.map(e => e?.scroll_depth).filter(d => typeof d === "number" && d >= 0 && d <= 1);

        const write = await Session.updateOne(
            { site_key: siteKey, session_id: sessionId },
            {
                ...(depths.length ? { $max: { max_scroll_depth: Math.max(...depths) } } : {}),
                $set: {
                    site_key: siteKey,
                    device_type: deviceType,
                    referrer: text(data.referrer, 2000),
                    page,
                    page_path: path,
                    start_time: data.start_time,
                    end_time: data.end_time,
                    summary: data.summary,
                    detailed,
                    updated_at: Date.now()
                },
                $setOnInsert: { visitor_id: visitorId },
                // A positive $slice keeps a session's first events and drops anything past the cap.
                $push: { events: { $each: keptEvents, $slice: MAX_SESSION_EVENTS } }
            },
            { upsert: true }
        );

        await countSession({
            siteKey, page, path, startTime: data.start_time, deviceType,
            clicks: events.filter(e => e?.type === "click").length,
            newSession: write.upsertedCount === 1
        });

        // Goals read every event in the batch, so visits past the plan's allowance still count.
        await markBatch(site, { session_id: sessionId, page, page_path: path, start_time: data.start_time, visitor_id: visitorId }, events, write.upsertedCount === 1);

        res.sendStatus(200);
    } catch (err) {
        logger.error("collect error:", err);
        res.sendStatus(500);
    }
});

module.exports = router;
