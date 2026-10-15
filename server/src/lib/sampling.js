// Full movement data is kept for every visit on quiet pages and for a random sample on busy ones. Visitor
// groups don't get more accurate past about a thousand visits a month, and full detail is ~10x a summary.
// Visits left out of the sample still keep their summary, scroll depth, clicks and taps.
const crypto = require("crypto");
const { PageDay } = require("../db/models");
const { getAccountSites } = require("./siteAccount");

const PAGE_DETAIL = 1000;
const ACCOUNT_DETAIL = 100000;
const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_MS = 60 * 60 * 1000;
const cache = new Map();

async function visitsSince(key, match) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    if (cache.size > 20000) cache.clear();
    const [row] = await PageDay.aggregate([{ $match: match }, { $group: { _id: null, visits: { $sum: "$sessions" } } }]);
    const value = row?.visits || 0;
    cache.set(key, { at: Date.now(), value });
    return value;
}

// Share of new visits that keep full detail, from the last 30 days of traffic so it doesn't favour early-month visits.
async function detailRate(account, siteKey, page, now = Date.now()) {
    const since = new Date(now - 30 * DAY_MS).toISOString().slice(0, 10);
    const siteKeys = getAccountSites(account).map(site => site.key);
    const [pageVisits, accountVisits] = await Promise.all([
        visitsSince(`page:${siteKey}|${page}`, { site_key: siteKey, page, day: { $gte: since } }),
        visitsSince(`account:${account._id}`, { site_key: { $in: siteKeys }, day: { $gte: since } })
    ]);
    return rateFor(pageVisits, accountVisits);
}

function rateFor(pageVisits, accountVisits) {
    return Math.min(1, PAGE_DETAIL / Math.max(pageVisits, 1), ACCOUNT_DETAIL / Math.max(accountVisits, 1));
}

// Decided from the visit's ID, so every batch of the same visit lands on the same side without a lookup.
function inSample(sessionId, rate) {
    if (rate >= 1) return true;
    const position = parseInt(crypto.createHash("sha256").update(sessionId).digest("hex").slice(0, 8), 16) / 0xffffffff;
    return position < rate;
}

module.exports = { detailRate, rateFor, inSample, PAGE_DETAIL, ACCOUNT_DETAIL };
