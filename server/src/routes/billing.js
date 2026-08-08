const express = require("express");
const router = express.Router();
const { getAuth } = require("@clerk/express");
const { requireAuth } = require("../middleware/auth");
const stripe = require("../lib/stripe");
const { Account } = require("../db/models");
const { TRACETRAY_MODE } = require("../config");
const logger = require("../lib/logger");

router.post("/api/create-checkout-session", requireAuth(), async (req, res) => {
    try {
        if (TRACETRAY_MODE !== "production") {
            return res.status(403).json({ error: "subscriptions are not available during the beta" });
        }

        const clerkUserId = getAuth(req).userId;
        const { plan } = req.body;

        const priceId = plan === "pro"
            ? process.env.STRIPE_PRO_PRICE_ID
            : process.env.STRIPE_STARTER_PRICE_ID;

        if (!priceId) return res.status(400).json({ error: "invalid plan" });

        const account = await Account.findOne({ clerk_user_id: clerkUserId });
        if (!account)  return res.status(404).json({ error: "account not found" });

        const host    = `${req.protocol}://${req.get("host")}`;
        const session = await stripe.checkout.sessions.create({
            mode:               "subscription",
            payment_method_types: ["card"],
            line_items: [{ price: priceId, quantity: 1 }],
            customer_email:     account.email,
            client_reference_id: account.site_key,
            success_url:        `${host}/dashboard.html?checkout=success`,
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
        logger.error("webhook signature error:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
        switch (event.type) {

            case "checkout.session.completed": {
                const session  = event.data.object;
                const siteKey  = session.client_reference_id;
                const cusId    = session.customer;
                const subId    = session.subscription;
                const sub      = await stripe.subscriptions.retrieve(subId);
                const priceId  = sub.items.data[0]?.price?.id;
                const plan     = priceId === process.env.STRIPE_PRO_PRICE_ID ? "pro" : "starter";

                await Account.updateOne(
                    { site_key: siteKey },
                    { $set: { stripe_customer_id: cusId, plan } }
                );
                logger.info(`subscription activated  key=${siteKey}  plan=${plan}`);
                break;
            }

            case "customer.subscription.updated": {
                const sub     = event.data.object;
                const cusId   = sub.customer;
                const priceId = sub.items.data[0]?.price?.id;
                const plan    = priceId === process.env.STRIPE_PRO_PRICE_ID ? "pro" : "starter";

                await Account.updateOne(
                    { stripe_customer_id: cusId },
                    { $set: { plan } }
                );
                logger.info(`subscription updated  customer=${cusId}  plan=${plan}`);
                break;
            }

            case "customer.subscription.deleted":
            case "invoice.payment_failed": {
                const cusId = event.data.object.customer;
                await Account.updateOne({ stripe_customer_id: cusId }, { $set: { plan: "none" } });
                logger.info(`subscription ended  customer=${cusId}`);
                break;
            }
        }
    } catch (err) {
        logger.error("webhook handler error:", err);
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
            return_url: `${host}/dashboard.html`
        });

        res.json({ url: session.url });
    } catch (err) {
        logger.error("billing portal error:", err);
        res.status(500).json({ error: "could not open billing portal" });
    }
});

module.exports = router;
