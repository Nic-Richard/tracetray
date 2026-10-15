// Marks visits that reached a goal (session.goal_hits) and counts them in the daily page rows
// (page_days.goals.<id>), so goal rates read small daily rows instead of every visit.
const { Account, Session, PageDay } = require("../db/models");
const { eventHits, pageGoalMarks, journeysOf, appliesTo, isGoalPage } = require("./goals");
const { dayOf } = require("./pageDays");
const logger = require("./logger");

const DAY_MS = 24 * 60 * 60 * 1000;
const CLICK_LOOKBACK_DAYS = 90;
const PAGE_LOOKBACK_DAYS = 396;
const BATCH = 500;
const MIN_WEEK_VISITS = 30;

// Adds each goal to the visit once and counts it in that visit's daily row the first time.
async function markHits(siteKey, sessionId, goalIds, { page, path, startTime }) {
    for (const id of goalIds) {
        const added = await Session.updateOne(
            { site_key: siteKey, session_id: sessionId, goal_hits: { $ne: id } },
            { $addToSet: { goal_hits: id } }
        );
        if (added.modifiedCount && page && path) {
            await PageDay.updateOne({ site_key: siteKey, page, path, day: dayOf(startTime) }, { $inc: { [`goals.${id}`]: 1 } });
        }
    }
}

async function markBatch(site, session, events, isNew) {
    const goals = site.goals || [];
    if (!goals.length) return;
    const hits = eventHits(goals, session, events);
    if (hits.length) await markHits(site.key, session.session_id, hits, { page: session.page, path: session.page_path, startTime: session.start_time });

    // Landing on a goal page marks the visitor's earlier pages in the same journey.
    if (!isNew || !session.visitor_id || !goals.some(g => isGoalPage(g, session))) return;
    const start = Number(session.start_time) || Date.now();
    const recent = await Session.find(
        { site_key: site.key, visitor_id: session.visitor_id, start_time: { $gte: start - DAY_MS, $lte: start } },
        { session_id: 1, page: 1, page_path: 1, start_time: 1, end_time: 1, _id: 0 }
    ).sort({ start_time: 1 }).lean();
    const journey = journeysOf(recent).find(j => j.some(s => s.session_id === session.session_id)) || [];
    for (const [sessionId, ids] of pageGoalMarks(goals, journey)) {
        const s = journey.find(x => x.session_id === sessionId);
        await markHits(site.key, sessionId, ids, { page: s.page, path: s.page_path, startTime: s.start_time });
    }
}

async function bulkMark(siteKey, marks) {
    let ops = [];
    for (const [sessionId, ids] of marks) {
        ops.push({ updateOne: { filter: { site_key: siteKey, session_id: sessionId }, update: { $addToSet: { goal_hits: { $each: ids } } } } });
        if (ops.length >= BATCH) { await Session.bulkWrite(ops, { ordered: false }); ops = []; }
    }
    if (ops.length) await Session.bulkWrite(ops, { ordered: false });
}

// Rebuilds one goal's daily counts from the marked visits, for days from `fromDay` on (all days when null).
async function recountGoal(siteKey, goalId, fromDay = null) {
    const days = fromDay ? { day: { $gte: fromDay } } : {};
    await PageDay.updateMany({ site_key: siteKey, ...days, [`goals.${goalId}`]: { $exists: true } }, { $unset: { [`goals.${goalId}`]: "" } });
    const rows = await Session.aggregate([
        { $match: { site_key: siteKey, goal_hits: goalId, page: { $ne: null }, page_path: { $ne: null } } },
        { $group: {
            _id: { page: "$page", path: "$page_path", day: { $dateToString: { format: "%Y-%m-%d", date: { $toDate: { $convert: { input: "$start_time", to: "long", onError: 0, onNull: 0 } } } } } },
            n: { $sum: 1 }
        } }
    ]).allowDiskUse(true);
    let ops = [];
    for (const row of rows) {
        if (fromDay && row._id.day < fromDay) continue;
        ops.push({ updateOne: { filter: { site_key: siteKey, page: row._id.page, path: row._id.path, day: row._id.day }, update: { $set: { [`goals.${goalId}`]: row.n } } } });
        if (ops.length >= BATCH) { await PageDay.bulkWrite(ops, { ordered: false }); ops = []; }
    }
    if (ops.length) await PageDay.bulkWrite(ops, { ordered: false });
}

// Applies a goal to stored visits: clicks and forms back 90 days (how long event detail is kept), pages back 13 months.
async function backfillGoal(siteKey, goal, now = Date.now()) {
    await Session.updateMany({ site_key: siteKey, goal_hits: goal.id }, { $pull: { goal_hits: goal.id } });
    const marks = new Map();
    if (goal.type === "click" || goal.type === "form") {
        const cursor = Session.aggregate([
            { $match: { site_key: siteKey, start_time: { $gte: now - CLICK_LOOKBACK_DAYS * DAY_MS }, "events.0": { $exists: true } } },
            { $project: { _id: 0, session_id: 1, page: 1, page_path: 1,
                events: { $filter: { input: "$events", cond: { $in: ["$$this.type", ["click", "tap", "form_submit"]] } } } } },
            { $match: { "events.0": { $exists: true } } }
        ]).allowDiskUse(true).cursor();
        for await (const s of cursor) if (eventHits([goal], s, s.events).length) marks.set(s.session_id, [goal.id]);
    } else {
        const cursor = Session.find(
            { site_key: siteKey, visitor_id: { $ne: null }, start_time: { $gte: now - PAGE_LOOKBACK_DAYS * DAY_MS } },
            { _id: 0, session_id: 1, visitor_id: 1, page: 1, page_path: 1, start_time: 1, end_time: 1 }
        ).sort({ visitor_id: 1, start_time: 1 }).lean().cursor();
        let visitor = null, visits = [];
        const flush = () => { for (const j of journeysOf(visits)) for (const [id, ids] of pageGoalMarks([goal], j)) marks.set(id, ids); };
        for await (const s of cursor) {
            if (s.visitor_id !== visitor) { flush(); visitor = s.visitor_id; visits = []; }
            visits.push(s);
        }
        flush();
    }
    await bulkMark(siteKey, marks);
    await recountGoal(siteKey, goal.id);
    return marks.size;
}

async function setBackfillState(siteKey, goalId, state) {
    await Account.updateOne(
        { "sites.key": siteKey },
        { $set: { "sites.$[s].goals.$[g].backfill": state, "sites.$[s].goals.$[g].backfill_at": new Date() } },
        { arrayFilters: [{ "s.key": siteKey }, { "g.id": goalId }] }
    );
}

// One backfill at a time per server, in the order goals were saved.
let queue = Promise.resolve();
function queueBackfill(siteKey, goal) {
    queue = queue.then(async () => {
        try {
            await setBackfillState(siteKey, goal.id, "running");
            const marked = await backfillGoal(siteKey, goal);
            await setBackfillState(siteKey, goal.id, "done");
            logger.info(`goal ${goal.id} on ${siteKey}: ${marked} past visits reached it`);
        } catch (err) {
            logger.error(`goal backfill error ${goal.id}:`, err);
            await setBackfillState(siteKey, goal.id, "failed").catch(() => {});
        }
    });
    return queue;
}

// Backfills that were queued or running when the server stopped.
async function resumeBackfills() {
    const accounts = await Account.find({ "sites.goals.backfill": { $in: ["queued", "running"] } }, { sites: 1 }).lean();
    for (const account of accounts) {
        for (const site of account.sites || []) {
            for (const goal of site.goals || []) if (["queued", "running"].includes(goal.backfill)) queueBackfill(site.key, goal);
        }
    }
}

async function removeGoalMarks(siteKey, goalId) {
    await Session.updateMany({ site_key: siteKey, goal_hits: goalId }, { $pull: { goal_hits: goalId } });
    await PageDay.updateMany({ site_key: siteKey, [`goals.${goalId}`]: { $exists: true } }, { $unset: { [`goals.${goalId}`]: "" } });
}

// The goal a page is judged by: its main goal, else the goal its visits reached most in the last 30 days.
async function mainGoalFor(siteKey, page) {
    const account = await Account.findOne({ "sites.key": siteKey }, { sites: 1 }).lean();
    const site = account?.sites?.find(item => item.key === siteKey);
    const goals = (site?.goals || []).filter(g => appliesTo(g, { page }) && !isGoalPage(g, { page }));
    const main = (site?.main_goals || []).find(m => m.page === page)?.goal;
    const chosen = goals.find(g => g.id === main);
    if (chosen || goals.length <= 1) return chosen || goals[0] || null;
    const reached = await Promise.all(goals.map(g => goalRate(siteKey, g, { page, days: 30 }).then(r => r.reached)));
    const best = reached.indexOf(Math.max(...reached));
    return reached[best] > 0 ? goals[best] : goals[0];
}

// Weekly goal rates (weeks start Monday, UTC) for the last `weeks` weeks, and the best full week with enough visits.
async function goalWeeks(siteKey, goal, { page = null, weeks = 12, now = Date.now() } = {}) {
    const today = new Date(now);
    const monday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - ((today.getUTCDay() + 6) % 7) * DAY_MS;
    const first = monday - (weeks - 1) * 7 * DAY_MS;
    const rows = await PageDay.find(
        { site_key: siteKey, day: { $gte: new Date(first).toISOString().slice(0, 10) }, ...(page ? { page } : {}) },
        { _id: 0, page: 1, path: 1, day: 1, sessions: 1, goals: 1 }
    ).lean();
    const buckets = Array.from({ length: weeks }, (_, i) => ({ week: new Date(first + i * 7 * DAY_MS).toISOString().slice(0, 10), visits: 0, reached: 0 }));
    for (const row of rows) {
        const session = { page: row.page, page_path: row.path };
        if (!appliesTo(goal, session) || isGoalPage(goal, session)) continue;
        const bucket = buckets[Math.floor((Date.parse(`${row.day}T00:00:00Z`) - first) / (7 * DAY_MS))];
        if (!bucket) continue;
        bucket.visits += row.sessions || 0;
        bucket.reached += row.goals?.[goal.id] || 0;
    }
    for (const b of buckets) b.rate = b.visits ? b.reached / b.visits : null;
    // The current week is still filling up, so it can't be the best one yet.
    const best = buckets.slice(0, -1).filter(b => b.visits >= MIN_WEEK_VISITS && b.rate !== null)
        .reduce((top, b) => (!top || b.rate > top.rate ? b : top), null);
    return { weeks: buckets, best };
}

// Visits and goal hits between two days (YYYY-MM-DD, `to` exclusive), for one page or every page the goal counts on.
// The goal page itself is left out of a page goal's rate.
async function goalTotals(siteKey, goal, { from = null, to = null, page = null } = {}) {
    const day = { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) };
    const rows = await PageDay.find(
        { site_key: siteKey, ...(from || to ? { day } : {}), ...(page ? { page } : {}) },
        { _id: 0, page: 1, path: 1, sessions: 1, goals: 1 }
    ).lean();
    let visits = 0, reached = 0;
    for (const row of rows) {
        const session = { page: row.page, page_path: row.path };
        if (!appliesTo(goal, session) || isGoalPage(goal, session)) continue;
        visits += row.sessions || 0;
        reached += row.goals?.[goal.id] || 0;
    }
    return { visits, reached, rate: visits ? reached / visits : null };
}

async function goalRate(siteKey, goal, { page = null, days = 30, now = Date.now() } = {}) {
    return goalTotals(siteKey, goal, { from: new Date(now - (days - 1) * DAY_MS).toISOString().slice(0, 10), page });
}

const MILESTONES = [100, 1000, 10000, 100000, 1000000];

function milestoneCrossed(before, after) {
    return [...MILESTONES].reverse().find(m => before < m && after >= m) || null;
}

const nextMilestone = total => MILESTONES.find(m => m > total) || null;

module.exports = { MILESTONES, milestoneCrossed, nextMilestone, goalTotals, mainGoalFor, goalWeeks, markBatch, markHits, backfillGoal, queueBackfill, resumeBackfills, recountGoal, removeGoalMarks, goalRate, setBackfillState };
