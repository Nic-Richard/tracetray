// Sends the weekly summary on Mondays from 13:00 UTC, once per account per week.
const { Account } = require("../db/models");
const { TRACETRAY_MODE } = require("../config");
const { getWeeklySummary, lastWeekStart } = require("../lib/weeklySummary");
const { weeklySummary } = require("../lib/emailTemplates");
const { sendEmail } = require("../lib/email");
const { unsubscribeUrl } = require("../lib/emailLinks");
const logger = require("../lib/logger");

const SEND_HOUR_UTC = 13;

// A Pro feature once plans are live (on unless turned off); during the beta only for accounts that turn it on.
function wantsWeeklySummary(account, mode = TRACETRAY_MODE) {
    const pref = account.email_prefs?.weekly_summary;
    if (mode !== "production") return pref === true;
    return ["pro", "enterprise"].includes(account.plan) && pref !== false;
}

async function runWeeklySummaries(now = Date.now()) {
    const week = new Date(lastWeekStart(now)).toISOString().slice(0, 10);
    const accounts = await Account.find({ weekly_summary_week: { $ne: week } }).lean();
    for (const account of accounts.filter(a => wantsWeeklySummary(a))) {
        try {
            const unsubscribe = unsubscribeUrl(account._id);
            if (!unsubscribe) throw new Error("EMAIL_LINK_SECRET isn't set, so there's no unsubscribe link");
            const summary = await getWeeklySummary(account, now);
            if (summary.sites.every(site => !site.visits && site.change === null)) {
                await Account.updateOne({ _id: account._id }, { $set: { weekly_summary_week: week } });
                continue;
            }
            const { sent } = await sendEmail({ to: account.email, ...weeklySummary({ ...summary, unsubscribe }), unsubscribe });
            if (sent) await Account.updateOne({ _id: account._id }, { $set: { weekly_summary_week: week } });
        } catch (err) {
            logger.error(`weekly summary failed for account ${account._id}:`, err);
        }
    }
}

function startWeeklySummaryJob() {
    const run = () => {
        const now = new Date();
        if (now.getUTCDay() !== 1 || now.getUTCHours() < SEND_HOUR_UTC) return;
        runWeeklySummaries().catch(err => logger.error("weekly summary job error:", err));
    };
    setInterval(run, 60 * 60 * 1000);
    setTimeout(run, 3 * 60 * 1000);
}

module.exports = { startWeeklySummaryJob, runWeeklySummaries, wantsWeeklySummary };
