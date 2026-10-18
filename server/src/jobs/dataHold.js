// Ends the 30-day data hold after a subscription ends: one notice 7 days before, then the
// account's site data is deleted (the account itself stays so its owner can come back).
// Production only; a subscription set delete_after when it ended and clears it on resubscribing.
const { Account } = require("../db/models");
const { TRACETRAY_MODE } = require("../config");
const { getAccountSites, deleteSiteData } = require("../lib/siteAccount");
const { sendEmail } = require("../lib/email");
const { deletionNotice } = require("../lib/emailTemplates");
const { sendAlert } = require("../lib/alerts");
const logger = require("../lib/logger");

const DAY_MS = 24 * 60 * 60 * 1000;
const NOTICE_DAYS = 7;
const ENDED = ["canceled", "unpaid", "incomplete_expired"];

// "notice", "delete" or null. Deleting needs a notice sent at least NOTICE_DAYS earlier, so a late
// or failed notice pushes the deletion back instead of cutting the warning short.
function holdAction(account, now = Date.now()) {
    if (account.deletion_requested_at || account.plan !== "none" || !account.delete_after || !ENDED.includes(account.subscription?.status)) return null;
    const deleteAt = new Date(account.delete_after).getTime();
    const noticedAt = account.deletion_notice_sent_at ? new Date(account.deletion_notice_sent_at).getTime() : null;
    if (noticedAt === null) return now >= deleteAt - NOTICE_DAYS * DAY_MS ? "notice" : null;
    return now >= deleteAt && now - noticedAt >= NOTICE_DAYS * DAY_MS ? "delete" : null;
}

async function sendNotice(account, now) {
    const deleteOn = new Date(Math.max(new Date(account.delete_after).getTime(), now + NOTICE_DAYS * DAY_MS));
    const mail = deletionNotice({ siteNames: getAccountSites(account).map(site => site.name), deleteOn });
    const { sent } = await sendEmail({ to: account.email, ...mail });
    if (!sent) throw new Error("the notice wasn't sent, so the deletion stays on hold");
    await Account.updateOne({ _id: account._id }, { $set: { delete_after: deleteOn, deletion_notice_sent_at: new Date(now) } });
    logger.info(`deletion notice sent  account=${account._id}  delete_on=${deleteOn.toISOString().slice(0, 10)}`);
}

async function deleteAccountData(account, now) {
    const totals = { sessions: 0, analyses: 0 };
    for (const site of getAccountSites(account)) {
        const removed = await deleteSiteData(site.key);
        totals.sessions += removed.sessions;
        totals.analyses += removed.analyses;
    }
    await Account.updateOne({ _id: account._id }, {
        $set: { data_deleted_at: new Date(now) },
        $unset: { delete_after: "", deletion_notice_sent_at: "" }
    });
    logger.info(`data deleted after hold  account=${account._id}  sessions=${totals.sessions}  analyses=${totals.analyses}`);
    sendAlert("billing", {
        title: "Data deleted after the 30-day hold",
        fields: [{ name: "Account", value: account.email }, { name: "Visits removed", value: String(totals.sessions) }],
    });
}

async function runDataHold(now = Date.now()) {
    const accounts = await Account.find({ deletion_requested_at: null, plan: "none", delete_after: { $lte: new Date(now + NOTICE_DAYS * DAY_MS) } }).lean();
    for (const account of accounts) {
        const action = holdAction(account, now);
        try {
            if (action === "notice") await sendNotice(account, now);
            else if (action === "delete") await deleteAccountData(account, now);
        } catch (err) {
            logger.error(`data hold ${action} failed for account ${account._id}:`, err);
        }
    }
}

function startDataHoldJob() {
    if (TRACETRAY_MODE !== "production") return;
    const run = () => runDataHold().catch(err => logger.error("data hold job error:", err));
    setTimeout(run, 2 * 60 * 1000);
    setInterval(run, 6 * 60 * 60 * 1000);
}

module.exports = { startDataHoldJob, runDataHold, holdAction };
