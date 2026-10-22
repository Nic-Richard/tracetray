// Applies each plan's limits.
// Counts that would cost a query on every request are cached per account for a few minutes;
// a limit can be crossed by a few minutes' worth of visits before it takes effect.
const { PageDay } = require("../db/models");
const { planLimits } = require("./plans");
const { getAccountSites } = require("./siteAccount");
const { monthOf, monthRange } = require("./usage");

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map();

function limitsFor(account) {
    return planLimits(account.plan);
}

async function cached(key, load) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const value = await load();
    cache.set(key, { at: Date.now(), value });
    return value;
}

function monthMatch(account, month) {
    const { from, to } = monthRange(month);
    return { site_key: { $in: getAccountSites(account).map(site => site.key) }, day: { $gte: from, $lt: to } };
}

// True once this month's visits pass the plan's allowance: later visits keep their summary only.
async function overVisitAllowance(account) {
    const limit = limitsFor(account)?.visits;
    if (!limit) return false;
    const month = monthOf();
    const visits = await cached(`visits:${account._id}:${month}`, async () => {
        const [row] = await PageDay.aggregate([
            { $match: monthMatch(account, month) },
            { $group: { _id: null, visits: { $sum: "$sessions" } } }
        ]);
        return row?.visits || 0;
    });
    return visits >= limit;
}

// Pages and groups are allowed in the order they were first visited this month, each counting as
// its number of addresses; one that doesn't fit in what's left of the limit is locked ("site|page").
async function lockedPages(account) {
    const limit = limitsFor(account)?.pages;
    if (!limit) return new Set();
    const month = monthOf();
    return cached(`pages:${account._id}:${month}`, async () => {
        const units = await PageDay.aggregate([
            { $match: monthMatch(account, month) },
            { $group: { _id: { site: "$site_key", page: "$page", path: "$path" }, first: { $min: "$day" } } },
            { $group: { _id: { site: "$_id.site", page: "$_id.page" }, addresses: { $sum: 1 }, first: { $min: "$first" } } },
            { $sort: { first: 1, "_id.site": 1, "_id.page": 1 } }
        ]);
        return lockUnits(units.map(unit => ({ key: `${unit._id.site}|${unit._id.page}`, addresses: unit.addresses })), limit);
    });
}

function lockUnits(units, limit) {
    const locked = new Set();
    let used = 0;
    for (const unit of units) {
        if (used + unit.addresses > limit) locked.add(unit.key);
        else used += unit.addresses;
    }
    return locked;
}

async function isPageLocked(account, siteKey, page) {
    if (!page || page === "all") return false;
    return (await lockedPages(account)).has(`${siteKey}|${page}`);
}

function askLimitReached(account, used) {
    const limit = limitsFor(account)?.askQuestions;
    return !!limit && used >= limit;
}

function hasFeature(account, feature) {
    return !!planLimits(account.plan)?.[feature];
}

module.exports = { hasFeature, limitsFor, overVisitAllowance, lockedPages, lockUnits, isPageLocked, askLimitReached };
