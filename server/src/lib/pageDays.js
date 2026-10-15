const { Session, PageDay } = require("../db/models");
const { groupPage, isGroup } = require("./pageGroups");
const logger = require("./logger");

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 1000;

function dayOf(startTime) {
    const ms = Number(startTime);
    return new Date(Number.isFinite(ms) && ms > 0 ? ms : Date.now()).toISOString().slice(0, 10);
}

function countSession({ siteKey, page, path, startTime, deviceType, clicks = 0, newSession }) {
    if (!page || !path) return null;
    const inc = { clicks };
    if (newSession) {
        inc.sessions = 1;
        inc[deviceType === "mobile" ? "mobile" : "desktop"] = 1;
    }
    if (!inc.sessions && !inc.clicks) return null;
    return PageDay.updateOne(
        { site_key: siteKey, page, path: path.slice(0, 2000), day: dayOf(startTime) },
        { $inc: inc },
        { upsert: true }
    );
}

const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function pageMembers(siteKey, page, { q = "", sort = "sessions", offset = 0, limit = 25, days = null } = {}) {
    const match = { site_key: siteKey, page };
    if (days) match.day = { $gte: new Date(Date.now() - (days - 1) * DAY_MS).toISOString().slice(0, 10) };
    const search = q ? [{ $match: { _id: { $regex: escapeRegex(q.slice(0, 200)), $options: "i" } } }] : [];
    const sortField = { sessions: "sessions", clicks: "clicks", recent: "last_day" }[sort] || "sessions";
    const [result] = await PageDay.aggregate([
        { $match: match },
        { $group: {
            _id: "$path",
            sessions: { $sum: "$sessions" },
            desktop:  { $sum: "$desktop" },
            mobile:   { $sum: "$mobile" },
            clicks:   { $sum: "$clicks" },
            last_day: { $max: "$day" }
        } },
        ...search,
        { $facet: {
            total: [{ $count: "n" }],
            rows:  [{ $sort: { [sortField]: -1, _id: 1 } }, { $skip: offset }, { $limit: limit }]
        } }
    ]).allowDiskUse(true);
    return {
        total: result?.total[0]?.n || 0,
        rows: (result?.rows || []).map(r => ({ path: r._id, sessions: r.sessions, desktop: r.desktop, mobile: r.mobile, clicks: r.clicks, last_day: r.last_day }))
    };
}

async function groupSizes(siteKey) {
    const rows = await PageDay.aggregate([
        { $match: { site_key: siteKey } },
        { $group: { _id: { page: "$page", path: "$path" } } },
        { $group: { _id: "$_id.page", paths: { $sum: 1 } } }
    ]).allowDiskUse(true);
    return Object.fromEntries(rows.filter(r => isGroup(r._id)).map(r => [r._id, r.paths]));
}

async function knownPaths(siteKey, limit = 50000) {
    const rows = await PageDay.aggregate([
        { $match: { site_key: siteKey } },
        { $group: { _id: "$path" } },
        { $limit: limit }
    ]).allowDiskUse(true);
    return rows.map(r => r._id);
}

// Re-files daily counts from before `before` (all of them when it's null) under the site's current rules,
// one day at a time so memory stays flat.
async function regroupDays(siteKey, rules, before) {
    const filter = { site_key: siteKey, ...(before ? { day: { $lt: before } } : {}) };
    let day = null, merged = new Map(), ids = [];
    const flush = async () => {
        if (!ids.length) return;
        await PageDay.deleteMany({ _id: { $in: ids } });
        await PageDay.insertMany([...merged.values()], { ordered: false });
        merged = new Map(); ids = [];
    };
    for await (const row of PageDay.find(filter).sort({ day: 1 }).lean().cursor()) {
        if (row.day !== day) { await flush(); day = row.day; }
        let page = row.page, path = row.path;
        try { ({ page, path } = groupPage(new URL(row.page).origin + row.path, rules)); } catch { /* keep the row as it was */ }
        const key = `${page}|${path}`;
        const sum = merged.get(key) || { site_key: siteKey, page, path, day: row.day, sessions: 0, desktop: 0, mobile: 0, clicks: 0 };
        for (const field of ["sessions", "desktop", "mobile", "clicks"]) sum[field] += row[field] || 0;
        merged.set(key, sum);
        ids.push(row._id);
    }
    await flush();
}

// Re-files every stored session under the site's current rules, then rebuilds its daily counts.
async function regroupSite(siteKey, rules) {
    const started = Date.now();
    let changed = 0;
    let ops = [];
    const cursor = Session.find({ site_key: siteKey }, { page: 1, page_path: 1 }).lean().cursor();
    for await (const s of cursor) {
        const source = s.page_path && s.page ? new URL(s.page).origin + s.page_path : s.page;
        if (!source) continue;
        let grouped;
        try { grouped = groupPage(source, rules); } catch { continue; }
        if (grouped.page === s.page && grouped.path === s.page_path) continue;
        ops.push({ updateOne: { filter: { _id: s._id }, update: { $set: { page: grouped.page, page_path: grouped.path } } } });
        if (ops.length >= BATCH) { changed += (await Session.bulkWrite(ops, { ordered: false })).modifiedCount; ops = []; }
    }
    if (ops.length) changed += (await Session.bulkWrite(ops, { ordered: false })).modifiedCount;

    // Visits are deleted after SESSION_RETENTION_DAYS, partway through a day, so daily counts up to and
    // including the oldest stored visit's day are regrouped from the counts themselves; the rest are rebuilt.
    const oldest = await Session.findOne({ site_key: siteKey, start_time: { $ne: null } }, { start_time: 1 }).sort({ start_time: 1 }).lean();
    const firstDay = oldest ? dayOf(Number(oldest.start_time) + DAY_MS) : null;
    await regroupDays(siteKey, rules, firstDay);
    if (firstDay) await PageDay.deleteMany({ site_key: siteKey, day: { $gte: firstDay } });
    await Session.aggregate([
        { $match: { site_key: siteKey, page: { $ne: null }, page_path: { $ne: null }, start_time: { $gte: firstDay ? Date.parse(`${firstDay}T00:00:00Z`) : 0 } } },
        { $group: {
            _id: {
                page: "$page",
                path: "$page_path",
                day: { $dateToString: { format: "%Y-%m-%d", date: { $toDate: { $convert: { input: "$start_time", to: "long", onError: null, onNull: null } } } } }
            },
            sessions: { $sum: 1 },
            desktop:  { $sum: { $cond: [{ $eq: ["$device_type", "mobile"] }, 0, 1] } },
            mobile:   { $sum: { $cond: [{ $eq: ["$device_type", "mobile"] }, 1, 0] } },
            // Count click events like live collection does; trimmed sessions fall back to their summary.
            clicks:   { $sum: { $cond: [
                { $gt: [{ $size: { $ifNull: ["$events", []] } }, 0] },
                { $size: { $filter: { input: "$events", cond: { $eq: ["$$this.type", "click"] } } } },
                { $ifNull: ["$summary.clicks", 0] }
            ] } }
        } },
        { $match: { "_id.day": { $ne: null } } },
        { $project: { _id: 0, site_key: siteKey, page: "$_id.page", path: "$_id.path", day: "$_id.day", sessions: 1, desktop: 1, mobile: 1, clicks: 1 } },
        { $merge: { into: "page_days", on: ["site_key", "page", "path", "day"], whenMatched: "replace", whenNotMatched: "insert" } }
    ]).allowDiskUse(true);

    logger.info(`regrouped ${siteKey}: ${changed} sessions moved in ${Math.round((Date.now() - started) / 1000)}s`);
    return changed;
}

module.exports = { countSession, pageMembers, groupSizes, knownPaths, regroupSite, regroupDays, dayOf };
