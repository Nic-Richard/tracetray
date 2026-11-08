// Moves accounts to Free once a plan given with scripts/grant-plan.js runs out. An account that started
// paying in the meantime keeps the plan Stripe gave it.
const { Account } = require("../db/models");
const logger = require("../lib/logger");

const ENDED = ["canceled", "unpaid", "incomplete_expired"];

async function endCompAccess(now = new Date()) {
    const result = await Account.updateMany(
        { comp_until: { $lte: now }, $or: [{ subscription: null }, { "subscription.status": { $in: ENDED } }] },
        { $set: { plan: "free" }, $unset: { comp_until: "" } }
    );
    await Account.updateMany({ comp_until: { $lte: now } }, { $unset: { comp_until: "" } });
    if (result.modifiedCount) logger.info(`comp access ended for ${result.modifiedCount} account(s)`);
    return result.modifiedCount;
}

function startCompAccessJob() {
    const run = () => endCompAccess().catch(err => logger.error("comp access job error:", err));
    setTimeout(run, 60 * 1000);
    setInterval(run, 60 * 60 * 1000);
}

module.exports = { startCompAccessJob, endCompAccess };
