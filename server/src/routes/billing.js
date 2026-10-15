const express = require("express");
const router = express.Router();
const { getAuth } = require("@clerk/express");
const { requireAuth } = require("../middleware/auth");
const stripe = require("../lib/stripe");
const { Account } = require("../db/models");
const { TRACETRAY_MODE } = require("../config");
const logger = require("../lib/logger");
const { sendAlert } = require("../lib/alerts");
const { PRICE_KEYS, planForPrice } = require("../lib/plans");

const TRIAL_DAYS = 30;
const DATA_HOLD_DAYS = 30;
const ENDED = ["canceled", "unpaid", "incomplete_expired"];

// Keeps the account's plan, subscription details and data hold in step with Stripe.
// past_due keeps the plan while Stripe retries the payment.
async function syncSubscription(filter, sub, extra = {}) {
    const item = sub.items?.data?.[0];
    const ended = ENDED.includes(sub.status);
    const plan = ended ? "none" : planForPrice(item?.price);
    const subscription = {
        id: sub.id,
        status: sub.status,
        interval: item?.price?.recurring?.interval || null,
        trial_end: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
        current_period_end: item?.current_period_end ? new Date(item.current_period_end * 1000) : null,
        cancel_at_period_end: !!sub.cancel_at_period_end
    };
    const update = ended
        ? [{ $set: { ...extra, plan, subscription, delete_after: { $ifNull: ["$delete_after", new Date(Date.now() + DATA_HOLD_DAYS * 86400000)] } } }]
        : [{ $set: { ...extra, plan, subscription } }, { $unset: ["delete_after", "deletion_notice_sent_at"] }];
    const result = await Account.updateOne(filter, update, { updatePipeline: true });
    return { plan, matched: result.matchedCount };
}

// Events for customers TraceTray doesn't know (tests, other apps on the same Stripe account) stay quiet.
async function alertAccount(title, customerId) {
    const account = await Account.findOne({ stripe_customer_id: customerId }, { email: 1 }).lean();
    sendAlert("billing", {
        title,
        fields: [{ name: "Account", value: account?.email || "unknown" }, { name: "Customer", value: customerId }],
    });
}

router.post("/api/create-checkout-session", requireAuth(), async (req, res) => {
    try {
        if (TRACETRAY_MODE !== "production") {
            return res.status(403).json({ error: "subscriptions are not available during the beta" });
        }

        const clerkUserId = getAuth(req).userId;
        const lookupKey = PRICE_KEYS[req.body.plan]?.[req.body.interval === "year" ? "year" : "month"];
        if (!lookupKey) return res.status(400).json({ error: "invalid plan" });

        const account = await Account.findOne({ clerk_user_id: clerkUserId });
        if (!account)  return res.status(404).json({ error: "account not found" });
        if (account.subscription && !ENDED.includes(account.subscription.status)) {
            return res.status(409).json({ error: "you already have a plan; change it from billing" });
        }

        const [price] = (await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })).data;
        if (!price) return res.status(500).json({ error: "that plan isn't available right now" });

        // One trial per account; the card is taken up front and charged when the trial ends.
        const trial   = !account.trial_used;
        const host    = `${req.protocol}://${req.get("host")}`;
        const session = await stripe.checkout.sessions.create({
            mode:               "subscription",
            line_items: [{ price: price.id, quantity: 1 }],
            ...(account.stripe_customer_id ? { customer: account.stripe_customer_id } : { customer_email: account.email }),
            client_reference_id: clerkUserId,
            payment_method_collection: "always",
            ...(trial ? { subscription_data: { trial_period_days: TRIAL_DAYS } } : {}),
            success_url:        `${host}/app/?checkout=success`,
            cancel_url:         `${host}/pricing.html`
        });

        res.json({ url: session.url });
    } catch (err) {
        logger.error("checkout error:", err);
        res.status(500).json({ error: "checkout failed" });
    }
});

router.post("/webhook/stripe", async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        logger.warn("webhook signature error:", err.message);
        sendAlert("billing", {
            title: "Stripe webhook refused: bad signature",
            description: "Check STRIPE_WEBHOOK_SECRET against the endpoint's signing secret.",
            key: "stripe-signature",
        });
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
        switch (event.type) {

            case "checkout.session.completed": {
                const session  = event.data.object;
                const ref      = session.client_reference_id;
                const cusId    = session.customer;
                const sub      = await stripe.subscriptions.retrieve(session.subscription);

                // Older checkouts used the account's site key, which changes when its last site is deleted.
                const { plan, matched } = await syncSubscription(
                    { $or: [{ clerk_user_id: ref }, { site_key: ref }] },
                    sub,
                    { stripe_customer_id: cusId, trial_used: true }
                );
                if (!matched) throw new Error(`no account for checkout reference ${ref}`);
                logger.info(`subscription activated  ref=${ref}  plan=${plan}  status=${sub.status}`);
                sendAlert("billing", {
                    title: sub.status === "trialing" ? `Trial started: ${plan}` : `Subscription started: ${plan}`,
                    fields: [{ name: "Customer", value: cusId }, { name: "Account", value: ref }],
                });
                break;
            }

            case "customer.subscription.updated": {
                const sub     = event.data.object;
                const cusId   = sub.customer;
                const { plan, matched } = await syncSubscription({ stripe_customer_id: cusId }, sub);
                logger.info(`subscription updated  customer=${cusId}  plan=${plan}  matched=${matched}`);
                if (matched) await alertAccount(`Subscription updated: ${plan} (${sub.status})`, cusId);
                break;
            }

            case "customer.subscription.deleted": {
                const cusId = event.data.object.customer;
                const { matched } = await syncSubscription({ stripe_customer_id: cusId }, event.data.object);
                logger.info(`subscription ended  customer=${cusId}  matched=${matched}`);
                if (matched) await alertAccount("Subscription ended", cusId);
                break;
            }
        }
    } catch (err) {
        logger.error("webhook handler error:", err);
        return res.status(500).json({ error: "webhook handling failed" });
    }

    res.json({ received: true });
});

router.post("/api/billing-portal", requireAuth(), async (req, res) => {
    try {
        const account = await Account.findOne({ clerk_user_id: getAuth(req).userId }).lean();
        if (!account) return res.status(404).json({ error: "account not found" });
        if (!account.stripe_customer_id) return res.status(400).json({ error: "no billing account found" });

        const host    = `${req.protocol}://${req.get("host")}`;
        const session = await stripe.billingPortal.sessions.create({
            customer:   account.stripe_customer_id,
            return_url: `${host}/app/`
        });

        res.json({ url: session.url });
    } catch (err) {
        logger.error("billing portal error:", err);
        res.status(500).json({ error: "could not open billing portal" });
    }
});

module.exports = router;
