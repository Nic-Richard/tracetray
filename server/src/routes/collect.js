const express = require("express");
const router = express.Router();
const { Account, Session } = require("../db/models");
const { ensureAccountSites } = require("../lib/siteAccount");
const { normalizeTrackingDomain, visitTime, cleanSummary, cleanReferrer } = require("../lib/tracking");
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

// Every tracker batch needs its site's account; a short cache saves a lookup per request, including for
// unknown keys. Plan, goal and group changes reach tracking within ACCOUNT_CACHE_MS.
const ACCOUNT_CACHE_MS = 30 * 1000;
const accountCache = new Map();

async function accountFor(siteKey) {
    const hit = accountCache.get(siteKey);
    if (hit && Date.now() - hit.at < ACCOUNT_CACHE_MS) return hit.account;
    const account = await Account.findOne({ $or: [{ site_key: siteKey }, { "sites.key": siteKey }] });
    if (account) await ensureAccountSites(account);
    if (accountCache.size > 10000) accountCache.clear();
    accountCache.set(siteKey, { at: Date.now(), account });
    return account;
}

router.post("/collect", async (req, res) => {
    try {
        if (overRateLimit(req.ip)) return res.sendStatus(429);

        const data = req.body || {};
        const siteKey = String(data.key || "").trim().slice(0, 64);
        const sessionId = String(data.session_id || "").trim().slice(0, 100);
        const events = (Array.isArray(data.events) ? data.events.slice(0, MAX_BATCH_EVENTS) : [])
            .filter(e => e && typeof e === "object" && !Array.isArray(e) && typeof e.type === "string");
        const originDomain = normalizeTrackingDomain(req.headers.origin);
        const pageDomain = normalizeTrackingDomain(data.page);
        const trackingDomain = originDomain || pageDomain;

        if (!siteKey || !sessionId || !trackingDomain) return res.sendStatus(204);
        if (originDomain && pageDomain && originDomain !== pageDomain) return res.sendStatus(204);

        let account = await accountFor(siteKey);
        if (!account) return res.sendStatus(204);

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

            accountCache.delete(siteKey);
            account = await accountFor(siteKey);
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
        // full detail for a sample of visits; the rest keep only clicks, taps and sent forms, which goals need.
        const overAllowance = await overVisitAllowance(account);
        const detailed = !overAllowance && inSample(sessionId, await detailRate(account, siteKey, page));
        const keptEvents = overAllowance ? [] : detailed ? events : events.filter(e => e?.type === "click" || e?.type === "tap" || e?.type === "form_submit");

        // Worked out here rather than sent by the tracker, which stores nothing on the visitor's device.
        // A visit keeps the ID from its first batch, even if it runs past midnight.
        const visitorId = await visitorIdFor({ siteKey, ip: req.ip, userAgent: req.get("user-agent"), language: req.get("accept-language") });

        // Kept outside the raw events so it outlives them (they're trimmed after RAW_EVENT_RETENTION_DAYS).
        // Only scrolls and measured page loads count: other events can carry measurements taken before the page loaded.
        const depths = events.filter(e => e.type === "scroll" || (e.type === "page_load" && e.measured === true))
            .map(e => e.scroll_depth).filter(d => typeof d === "number" && d >= 0 && d <= 1);

        const now = Date.now();
        const startTime = visitTime(data.start_time, now);
        const endTime = data.end_time === undefined || data.end_time === null ? undefined : Math.max(startTime, visitTime(data.end_time, now));

        const write = await Session.updateOne(
            { site_key: siteKey, session_id: sessionId },
            {
                ...(depths.length ? { $max: { max_scroll_depth: Math.max(...depths) } } : {}),
                $set: {
                    site_key: siteKey,
                    device_type: deviceType,
                    referrer: cleanReferrer(data.referrer),
                    page,
                    page_path: path,
                    start_time: startTime,
                    end_time: endTime,
                    summary: cleanSummary(data.summary),
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
            siteKey, page, path, startTime, deviceType,
            clicks: events.filter(e => e?.type === "click").length,
            newSession: write.upsertedCount === 1
        });

        // Goals read every event in the batch, so visits past the plan's allowance still count.
        await markBatch(site, { session_id: sessionId, page, page_path: path, start_time: startTime, visitor_id: visitorId }, events, write.upsertedCount === 1);

        res.sendStatus(200);
    } catch (err) {
        logger.error("collect error:", err);
        res.sendStatus(500);
    }
});

module.exports = router;
