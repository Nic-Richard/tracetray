const SETTLE_MS = 60_000;
const RETENTION_MS = 30 * 86400000;
const { PRICE_KEYS } = require("./plans");
const TRACE_PRICES = new Set(Object.values(PRICE_KEYS).flatMap(Object.values));

function deletionStatus(job) {
    return job ? { state: job.state, requested_at: job.requested_at, completed_at: job.completed_at || null } : { state: "none" };
}

async function closeBilling(stripe, references, customerId, subscriptionId) {
    if (!stripe) {
        if (customerId) throw new Error("Stripe is unavailable for an account with billing");
        return;
    }
    for await (const session of stripe.checkout.sessions.list({ status: "open", limit: 100 })) {
        if (references.includes(session.client_reference_id)) await stripe.checkout.sessions.expire(session.id);
    }
    if (!customerId) return;
    for await (const sub of stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 })) {
        const owned = sub.id === subscriptionId || sub.items?.data?.some(item => TRACE_PRICES.has(item.price?.lookup_key));
        if (owned && !["canceled", "incomplete_expired"].includes(sub.status)) {
            await stripe.subscriptions.cancel(sub.id, { invoice_now: false, prorate: false });
        }
    }
}

function createAccountDeletion({ Account, AccountDeletion, BugReport, clerk, stripe, getSites, deleteSiteData, analysisRunning, shotsPending = () => false, collectionPending = () => false }) {
    async function request(userId, confirmation, now = new Date()) {
        if (confirmation !== "DELETE") return { status: 400, body: { error: "Type DELETE to confirm permanent account deletion." } };
        const account = await Account.findOne({ clerk_user_id: userId }).lean();
        const job = await AccountDeletion.findOneAndUpdate({ clerk_user_id: userId }, { $setOnInsert: {
            account_id: account?._id, requested_at: now, state: "pending", next_attempt_at: now,
            references: [...new Set([userId, account?.site_key].filter(Boolean))]
        } }, { upsert: true, new: true });
        if (account && job.state !== "complete") await Account.updateOne({ _id: account._id, deletion_requested_at: null }, { $set: { deletion_requested_at: now } });
        return { status: 202, body: deletionStatus(job) };
    }

    async function process(job, now = new Date()) {
        const account = await Account.findOne({ clerk_user_id: job.clerk_user_id }).lean();
        if (account && !account.deletion_requested_at) {
            await Account.updateOne({ _id: account._id }, { $set: { deletion_requested_at: now } });
            return false;
        }
        // Let cached collection requests drain, and never race an analysis process writing its results.
        if (account && (now - new Date(account.deletion_requested_at) < SETTLE_MS || getSites(account).some(site => analysisRunning[site.key] || shotsPending(site.key) || collectionPending(site.key)))) return false;
        await closeBilling(stripe, job.references, account?.stripe_customer_id, account?.subscription?.id);
        if (account) {
            for (const site of getSites(account)) await deleteSiteData(site.key);
            await BugReport.deleteMany({ account_id: account._id });
        }
        try { await clerk.users.deleteUser(job.clerk_user_id); }
        catch (error) { if (error.status !== 404 && error.statusCode !== 404) throw error; }
        if (account) await Account.deleteOne({ _id: account._id, clerk_user_id: job.clerk_user_id });
        await AccountDeletion.updateOne({ _id: job._id }, { $set: {
            state: "complete", completed_at: now, expires_at: new Date(+now + RETENTION_MS)
        }, $unset: { account_id: "", next_attempt_at: "", lease_until: "" } });
        return true;
    }
    return { request, process };
}

module.exports = { createAccountDeletion, deletionStatus, closeBilling, SETTLE_MS };
