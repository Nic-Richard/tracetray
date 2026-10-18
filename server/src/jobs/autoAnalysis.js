// Re-analyzes each account's busiest pages once a week (Sundays from 06:00 UTC, before the Monday
// summary), so groups and trends stay current without anyone pressing Refresh. Pages that moved a
// lot are emailed to accounts that get behaviour-shift alerts.
const { Account, AnalysisResult } = require("../db/models");
const { TRACETRAY_MODE } = require("../config");
const { getAccountSites } = require("../lib/siteAccount");
const { getPages } = require("../lib/siteData");
const { lockedPages } = require("../lib/limits");
const { PLANS, planLimits } = require("../lib/plans");
const { runAnalysis } = require("../lib/runAnalysis");
const { biggestShift } = require("../lib/groupShifts");
const { wantsEmail } = require("../lib/emailPrefs");
const { unsubscribeUrl } = require("../lib/emailLinks");
const { shiftAlert } = require("../lib/emailTemplates");
const { sendEmail } = require("../lib/email");
const { lastWeekStart } = require("../lib/weeklySummary");
const logger = require("../lib/logger");

const RUN_DAY_UTC = 0;
const RUN_HOUR_UTC = 6;
const MIN_ANALYSABLE = 16;
const ALERT_SHIFT = 0.10;
const DAY_MS = 24 * 60 * 60 * 1000;
let running = false;

function weeklyPageCap(account, mode = TRACETRAY_MODE) {
    if (mode !== "production") return PLANS.pro.weeklyPages;
    return planLimits(account.plan)?.weeklyPages || 0;
}

// Busiest pages first, skipping locked pages, pages with too few active visits and pages with
// nothing new since their last analysis.
function pickPages(pages, lastRuns, locked, siteKey, cap) {
    return pages
        .filter(p => p.analysable >= MIN_ANALYSABLE && !locked.has(`${siteKey}|${p.page}`))
        .filter(p => !lastRuns.get(p.page) || (p.last_seen || 0) > lastRuns.get(p.page))
        .sort((a, b) => b.sessions - a.sessions)
        .slice(0, cap);
}

async function analyzeAccount(account) {
    let budget = weeklyPageCap(account);
    const locked = await lockedPages(account);
    const shifts = [];
    for (const site of getAccountSites(account)) {
        if (budget <= 0) break;
        const [pages, runs] = await Promise.all([
            getPages(site.key),
            AnalysisResult.aggregate([{ $match: { site_key: site.key } }, { $group: { _id: "$page", ran_at: { $max: "$ran_at" } } }])
        ]);
        const lastRuns = new Map(runs.map(r => [r._id, new Date(r.ran_at).getTime()]));
        for (const page of pickPages(pages, lastRuns, locked, site.key, budget)) {
            budget--;
            try {
                const previous = await AnalysisResult.findOne({ site_key: site.key, page: page.page, k: { $gt: 0 } }).sort({ ran_at: -1 }).lean();
                const latest = await runAnalysis(site.key, page.page);
                const shift = previous && latest.k > 0 && biggestShift(previous, latest, ALERT_SHIFT);
                if (shift) shifts.push({ site: site.name, page: page.page, ...shift });
            } catch (err) {
                if (err.code !== "BUSY") logger.error(`weekly analysis failed  key=${site.key}  page=${page.page}:`, err);
            }
        }
    }
    return shifts;
}

async function runAutoAnalysis(now = Date.now()) {
    const thisMonday = new Date(lastWeekStart(now) + 7 * DAY_MS).toISOString().slice(0, 10);
    const accounts = await Account.find({ deletion_requested_at: null, auto_analysis_week: { $ne: thisMonday } }).lean();
    for (const account of accounts.filter(a => weeklyPageCap(a) > 0)) {
        try {
            const shifts = await analyzeAccount(account);
            await Account.updateOne({ _id: account._id }, { $set: { auto_analysis_week: thisMonday } });
            if (shifts.length && wantsEmail(account, "shift_alerts") && await Account.exists({ _id: account._id, deletion_requested_at: null })) {
                const unsubscribe = unsubscribeUrl(account._id, "shift_alerts");
                if (unsubscribe) await sendEmail({ to: account.email, ...shiftAlert({ shifts, unsubscribe }), unsubscribe });
            }
        } catch (err) {
            logger.error(`weekly analysis failed for account ${account._id}:`, err);
        }
    }
}

function startAutoAnalysisJob() {
    const run = () => {
        const now = new Date();
        if (running || now.getUTCDay() !== RUN_DAY_UTC || now.getUTCHours() < RUN_HOUR_UTC) return;
        running = true;
        runAutoAnalysis().catch(err => logger.error("weekly analysis job error:", err)).finally(() => { running = false; });
    };
    setInterval(run, 60 * 60 * 1000);
    setTimeout(run, 4 * 60 * 1000);
}

module.exports = { startAutoAnalysisJob, runAutoAnalysis, pickPages, weeklyPageCap };
