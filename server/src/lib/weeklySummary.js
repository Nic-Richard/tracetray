// The numbers behind the weekly summary email: last full week (Monday to Sunday, UTC) against
// the week before, per website.
const { PageDay, AnalysisResult } = require("../db/models");
const { getAccountSites } = require("./siteAccount");
const { biggestShift } = require("./groupShifts");
const { goalTotals, goalWeeks, milestoneCrossed, mainGoalFor } = require("./goalHits");
const { compareAroundChange } = require("./compare");

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MOVER_VISITS = 20;
const MIN_SHIFT = 0.05;
const MAX_GOALS = 5;
const MIN_BEST_WEEKS = 4;
const MIN_WEEK_VISITS = 30;
const WIN_LOOKBACK_DAYS = 21;

const day = ms => new Date(ms).toISOString().slice(0, 10);

// The Monday that starts the last full week before `now`.
function lastWeekStart(now = Date.now()) {
    const today = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
    const sinceMonday = (new Date(today).getUTCDay() + 6) % 7;
    return today - (sinceMonday + 7) * DAY_MS;
}

function change(current, previous) {
    return previous ? (current - previous) / previous : null;
}

async function pageTotals(siteKey, from, to) {
    const rows = await PageDay.aggregate([
        { $match: { site_key: siteKey, day: { $gte: day(from), $lt: day(to) } } },
        { $group: { _id: "$page", visits: { $sum: "$sessions" }, desktop: { $sum: "$desktop" }, mobile: { $sum: "$mobile" } } }
    ]);
    return new Map(rows.map(r => [r._id, r]));
}

// The visitor group whose share moved most between a page's latest run this week and the run before it.
async function groupShifts(siteKey, from, to) {
    const recent = await AnalysisResult.find({ site_key: siteKey, ran_at: { $gte: new Date(from), $lt: new Date(to) }, k: { $gt: 0 } })
        .sort({ ran_at: -1 }).lean();
    const seen = new Set();
    const shifts = [];
    for (const latest of recent) {
        if (seen.has(latest.page)) continue;
        seen.add(latest.page);
        const before = await AnalysisResult.findOne({ site_key: siteKey, page: latest.page, ran_at: { $lt: latest.ran_at }, k: { $gt: 0 } })
            .sort({ ran_at: -1 }).lean();
        const shift = before && biggestShift(before, latest, MIN_SHIFT);
        if (shift) shifts.push({ page: latest.page, ...shift, delta: shift.to - shift.from });
    }
    return shifts.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 3);
}

// Each goal's week against the week before, plus the moments worth celebrating: a best week (out of at
// least four full ones), a milestone passed and a target met.
async function goalLines(site, start) {
    const end = start + 7 * DAY_MS, prevStart = start - 7 * DAY_MS;
    const lines = [];
    for (const goal of (site.goals || []).slice(0, MAX_GOALS)) {
        const [week, prev, before, after, trend] = await Promise.all([
            goalTotals(site.key, goal, { from: day(start), to: day(end) }),
            goalTotals(site.key, goal, { from: day(prevStart), to: day(start) }),
            goalTotals(site.key, goal, { to: day(start) }),
            goalTotals(site.key, goal, { to: day(end) }),
            goalWeeks(site.key, goal, { now: end })
        ]);
        if (!week.visits) continue;
        const fullWeeks = trend.weeks.slice(0, -1).filter(w => w.visits >= MIN_WEEK_VISITS).length;
        lines.push({
            name: goal.name,
            rate: week.rate,
            previous: prev.visits ? prev.rate : null,
            bestWeek: fullWeeks >= MIN_BEST_WEEKS && trend.best?.week === day(start),
            milestone: milestoneCrossed(before.reached, after.reached),
            targetMet: goal.target != null && week.visits >= MIN_WEEK_VISITS && week.rate >= goal.target ? goal.target : null
        });
    }
    return lines;
}

// Marked changes from the last three weeks that have since clearly raised their page's goal.
async function recentWins(site, start) {
    const end = start + 7 * DAY_MS;
    const wins = [];
    for (const change of site.page_changes || []) {
        if (change.day < day(start - WIN_LOOKBACK_DAYS * DAY_MS) || change.day >= day(end)) continue;
        const goal = await mainGoalFor(site.key, change.page);
        if (!goal) continue;
        const result = await compareAroundChange(site.key, change.page, change.day, end, goal);
        if (result.goal?.verdict === "better") wins.push({ page: change.page, day: change.day, note: change.note, goal: goal.name, before: result.goal.before, after: result.goal.after });
    }
    return wins.slice(0, 3);
}

async function siteSummary(site, start) {
    const end = start + 7 * DAY_MS, prevStart = start - 7 * DAY_MS;
    const [week, prev] = await Promise.all([pageTotals(site.key, start, end), pageTotals(site.key, prevStart, start)]);
    const sum = (map, key) => [...map.values()].reduce((s, r) => s + r[key], 0);
    const visits = sum(week, "visits"), previous = sum(prev, "visits");
    const pages = [...week.values()].map(r => ({ page: r._id, visits: r.visits, change: change(r.visits, prev.get(r._id)?.visits || 0) }))
        .sort((a, b) => b.visits - a.visits);
    const mover = pages
        .filter(p => p.change !== null && Math.max(p.visits, prev.get(p.page)?.visits || 0) >= MIN_MOVER_VISITS)
        .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0] || null;
    return {
        name: site.name,
        visits,
        change: change(visits, previous),
        mobileShare: visits ? sum(week, "mobile") / visits : 0,
        topPages: pages.slice(0, 3),
        mover: mover && Math.abs(mover.change) >= 0.25 ? mover : null,
        shifts: await groupShifts(site.key, start, end),
        goals: await goalLines(site, start),
        wins: await recentWins(site, start)
    };
}

async function getWeeklySummary(account, now = Date.now()) {
    const start = lastWeekStart(now);
    const sites = [];
    for (const site of getAccountSites(account)) sites.push(await siteSummary(site, start));
    return { from: day(start), to: day(start + 6 * DAY_MS), sites };
}

module.exports = { getWeeklySummary, lastWeekStart };
