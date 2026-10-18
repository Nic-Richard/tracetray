const { clerkClient } = require("@clerk/express");
const { Account, AccountDeletion, BugReport } = require("../db/models");
const { getAccountSites, deleteSiteData } = require("../lib/siteAccount");
const { analysisRunning } = require("../lib/analysisState");
const { shotsPending } = require("../lib/pageShots");
const { collectionPending } = require("../lib/collectionState");
const { eraseAccountAlerts } = require("../lib/alertErasure");
const { accountRequestsPending } = require("../middleware/accountClosing");
const { createAccountDeletion } = require("../lib/accountDeletion");
const logger = require("../lib/logger");

const service = createAccountDeletion({ Account, AccountDeletion, BugReport, clerk: clerkClient,
    stripe: process.env.STRIPE_SECRET_KEY ? require("../lib/stripe") : null,
    getSites: getAccountSites, deleteSiteData, analysisRunning, shotsPending, collectionPending, accountRequestsPending, eraseAlerts: eraseAccountAlerts });

let running = false;
async function runAccountDeletion() {
    if (running) return;
    running = true;
    try {
        for (let count = 0; count < 20; count++) {
            const now = new Date();
            const job = await AccountDeletion.findOneAndUpdate({ state: { $ne: "complete" }, next_attempt_at: { $lte: now },
                $or: [{ lease_until: null }, { lease_until: { $lte: now } }] },
            { $set: { lease_until: new Date(+now + 10 * 60_000) } }, { new: true });
            if (!job) break;
            try {
                if (await service.process(job, now)) continue;
                await AccountDeletion.updateOne({ _id: job._id }, { $set: { next_attempt_at: new Date(Date.now() + 60_000) }, $unset: { lease_until: "" } });
            } catch (error) {
                logger.error(`account deletion failed  request=${job._id}:`, error);
                await AccountDeletion.updateOne({ _id: job._id }, { $set: { state: "retrying", next_attempt_at: new Date(Date.now() + 60_000) }, $unset: { lease_until: "" } });
            }
        }
    } finally { running = false; }
}

function startAccountDeletionJob() {
    const run = () => runAccountDeletion().catch(error => logger.error("account deletion job error:", error));
    setTimeout(run, 5000).unref();
    setInterval(run, 60_000).unref();
}

module.exports = { service, runAccountDeletion, startAccountDeletionJob };
