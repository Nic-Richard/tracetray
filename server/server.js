
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const express      = require("express");
const mongoose     = require("mongoose");
const cors         = require("cors");
const path         = require("path");
const crypto       = require("crypto");
const fs           = require("fs");
const { spawn }    = require("child_process");
const Stripe       = require("stripe");
const { clerkMiddleware, getAuth, clerkClient } = require("@clerk/express");

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();

app.use(cors());
app.use(clerkMiddleware());

function requireAuth() {
    return (req, res, next) => {
        const { userId } = getAuth(req);
        if (!userId) return res.status(401).json({ error: "unauthorized" });
        next();
    };
}

// Stripe verifies the raw webhook body.
app.use("/webhook/stripe", express.raw({ type: "application/json" }));
app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/client", express.static(path.join(__dirname, "..", "client")));

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/sessionDB";
const TRACETRAY_MODE = process.env.TRACETRAY_MODE === "production" ? "production" : "beta";
mongoose.connection.on("error", err => console.error("MongoDB error:", err.message));


const Account = mongoose.model("Account", new mongoose.Schema({
    site_key:          { type: String, required: true, unique: true, index: true },
    clerk_user_id:     { type: String, unique: true, sparse: true, index: true },
    email:             { type: String, required: true },
    site_url:          String,
    sites: [{
        key:        { type: String, required: true },
        name:       { type: String, required: true },
        url:        String,
        domain:     String,
        refresh_day: String,
        page_refresh_count: { type: Number, default: 0 },
        last_page_refresh_at: Date,
        last_all_refresh_at: Date,
        created_at: Date
    }],
    stripe_customer_id: String,
    plan:              { type: String, enum: ["starter", "pro", "none"], default: "none" },
    created_at:        Date
}, { strict: false }), "accounts");

const Session = mongoose.model("Session", new mongoose.Schema({
    site_key:    { type: String, index: true },
    visitor_id:  { type: String, index: true },
    device_type: { type: String, enum: ["desktop", "mobile"], default: "desktop", index: true },
    referrer:    String
}, { strict: false }), "sessions");

const AnalysisResult = mongoose.model("AnalysisResult", new mongoose.Schema({
    site_key:            { type: String, index: true },
    page:                { type: String, default: "all", index: true },
    ran_at:              Date,
    session_count:       Number,
    k:                   Number,
    algorithm_agreement: Number,
    silhouette_score:    Number,
    k_rationale:         mongoose.Schema.Types.Mixed,
    clusters: [{
        id:            Number,
        label:         String,
        n:             Number,
        feature_means: mongoose.Schema.Types.Mixed
    }],
    kruskal_wallis: [{
        feature:     String,
        H_statistic: Number,
        p_value:     Number,
        significant: String
    }],
    click_summary: [{
        text:  String,
        tag:   String,
        count: Number
    }],
    ai_interpretation: {
        page_type:             String,
        site_summary:          String,
        cluster_stories:       mongoose.Schema.Types.Mixed,
        top_suggestions:       [String],
        data_note:             String,
        first_impression_note: String,
        device_comparison:     String
    }
}, { strict: false }), "analysis_results");

const BugReport = mongoose.model("BugReport", new mongoose.Schema({
    account_id:    { type: mongoose.Schema.Types.ObjectId, ref: "Account", required: true, index: true },
    clerk_user_id: { type: String, required: true, index: true },
    site_key:      { type: String, required: true, index: true },
    email:         String,
    category:      { type: String, enum: ["bug", "account", "billing", "suggestion", "other"], default: "bug" },
    description:   { type: String, required: true, maxlength: 5000 },
    dashboard_section: String,
    page_url:      String,
    user_agent:    String,
    status:        { type: String, enum: ["open", "resolved"], default: "open", index: true },
    created_at:    { type: Date, default: Date.now, index: true }
}), "bug_reports");


function generateSiteKey() {
    return "tt_" + crypto.randomBytes(12).toString("base64url");
}

const MAX_SITES_PER_ACCOUNT = 5;

function getSiteLimit(account) {
    if (TRACETRAY_MODE === "beta") return MAX_SITES_PER_ACCOUNT;
    return account.plan === "pro" ? MAX_SITES_PER_ACCOUNT : 1;
}

function getAccountSites(account) {
    if (Array.isArray(account.sites) && account.sites.length) return account.sites;
    if (!account.site_key) return [];
    return [{
        key: account.site_key,
        name: account.site_url || "My website",
        url: account.site_url || null,
        domain: null,
        created_at: account.created_at || new Date()
    }];
}

async function ensureAccountSites(account) {
    if (Array.isArray(account.sites) && account.sites.length) return account.sites;
    account.sites = getAccountSites(account);
    await account.save();
    return account.sites;
}

function resolveSiteKey(req, account) {
    const sites = getAccountSites(account);
    const requested = String(req.query.site_key || req.body?.site_key || "").trim();
    const selected = requested || sites[0]?.key || account.site_key;
    return sites.some(site => site.key === selected) ? selected : null;
}

function getClientIP(req) {
    return (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown")
        .split(",")[0].trim();
}

async function deleteSiteData(siteKey) {
    const [sessions, analyses, reports] = await Promise.all([
        Session.deleteMany({ site_key: siteKey }),
        AnalysisResult.deleteMany({ site_key: siteKey }),
        BugReport.deleteMany({ site_key: siteKey })
    ]);

    delete analysisRunning[siteKey];

    const featureDir = path.join(__dirname, "..", "data", "features");
    for (const device of ["desktop", "mobile"]) {
        const file = path.join(featureDir, `dataset_${siteKey}_${device}.json`);
        if (fs.existsSync(file)) fs.unlinkSync(file);
    }

    return {
        sessions: sessions.deletedCount,
        analyses: analyses.deletedCount,
        reports: reports.deletedCount
    };
}


app.post("/api/account", requireAuth(), async (req, res) => {
    try {
        const clerkUserId = getAuth(req).userId;
        const clerkUser   = await clerkClient.users.getUser(clerkUserId);
        const email       = clerkUser.emailAddresses[0]?.emailAddress || "";

        let account = await Account.findOne({ clerk_user_id: clerkUserId });

        if (!account) {
            const site_key = generateSiteKey();
            account = await Account.create({
                site_key,
                clerk_user_id: clerkUserId,
                email,
                site_url:   req.body.site_url || null,
                sites: [{
                    key: site_key,
                    name: req.body.site_name || req.body.site_url || "My website",
                    url: req.body.site_url || null,
                    domain: null,
                    created_at: new Date()
                }],
                plan:       "none",
                created_at: new Date()
            });
            console.log(`new account  email=${email}  key=${site_key}`);
        }

        const sites = await ensureAccountSites(account);
        const host = `${req.protocol}://${req.get("host")}`;
        res.json({
            site_key:  sites[0].key,
            sites,
            site_limit: getSiteLimit(account),
            plan:      account.plan,
            dashboard: `${host}/dashboard.html`,
            snippet:   `<script>\n  window.TraceTray = { endpoint: "${host}/collect", key: "${sites[0].key}" };\n</script>\n<script src="${host}/client/tracker.js"></script>`
        });
    } catch (err) {
        console.error("account error:", err);
        res.status(500).json({ error: "account setup failed" });
    }
});

app.get("/api/sites", requireAuth(), async (req, res) => {
    try {
        const account = await Account.findOne({ clerk_user_id: getAuth(req).userId });
        if (!account) return res.status(404).json({ error: "account not found" });
        const sites = await ensureAccountSites(account);
        res.json({ sites, limit: getSiteLimit(account) });
    } catch (err) {
        console.error("sites error:", err);
        res.status(500).json({ error: "could not load websites" });
    }
});

app.post("/api/sites", requireAuth(), async (req, res) => {
    try {
        const account = await Account.findOne({ clerk_user_id: getAuth(req).userId });
        if (!account) return res.status(404).json({ error: "account not found" });

        const sites = await ensureAccountSites(account);
        const siteLimit = getSiteLimit(account);
        if (sites.length >= siteLimit) {
            return res.status(400).json({ error: `you can add up to ${siteLimit} website${siteLimit === 1 ? "" : "s"}` });
        }

        const name = String(req.body.name || "").trim().slice(0, 80);
        const url = String(req.body.url || "").trim().slice(0, 500) || null;
        if (!name) return res.status(400).json({ error: "website name is required" });

        let key;
        do { key = generateSiteKey(); } while (await Account.exists({ $or: [{ site_key: key }, { "sites.key": key }] }));

        const site = { key, name, url, domain: null, created_at: new Date() };
        account.sites.push(site);
        await account.save();
        res.status(201).json({ site, sites: account.sites, limit: siteLimit });
    } catch (err) {
        console.error("create site error:", err);
        res.status(500).json({ error: "could not create website" });
    }
});

app.patch("/api/sites/:key", requireAuth(), async (req, res) => {
    try {
        const account = await Account.findOne({ clerk_user_id: getAuth(req).userId });
        if (!account) return res.status(404).json({ error: "account not found" });

        await ensureAccountSites(account);
        const site = account.sites.find(item => item.key === req.params.key);
        if (!site) return res.status(404).json({ error: "website not found" });

        const name = String(req.body.name || "").trim().slice(0, 80);
        if (!name) return res.status(400).json({ error: "website name is required" });

        site.name = name;
        await account.save();

        res.json({ site, sites: account.sites, limit: getSiteLimit(account) });
    } catch (err) {
        console.error("rename site error:", err);
        res.status(500).json({ error: "could not rename website" });
    }
});

app.delete("/api/sites/:key", requireAuth(), async (req, res) => {
    try {
        const account = await Account.findOne({ clerk_user_id: getAuth(req).userId });
        if (!account) return res.status(404).json({ error: "account not found" });

        await ensureAccountSites(account);
        const siteKey = req.params.key;
        const siteIndex = account.sites.findIndex(item => item.key === siteKey);
        if (siteIndex < 0) return res.status(404).json({ error: "website not found" });

        const deleted = await deleteSiteData(siteKey);

        if (account.sites.length === 1) {
            let newKey;
            do {
                newKey = generateSiteKey();
            } while (await Account.exists({
                $or: [{ site_key: newKey }, { "sites.key": newKey }]
            }));

            account.sites = [{
                key: newKey,
                name: "My website",
                url: null,
                domain: null,
                refresh_day: null,
                page_refresh_count: 0,
                last_page_refresh_at: null,
                last_all_refresh_at: null,
                created_at: new Date()
            }];
            account.site_key = newKey;
            account.site_url = null;
            await account.save();

            return res.json({
                deleted: true,
                reset: true,
                deleted_sessions: deleted.sessions,
                deleted_analyses: deleted.analyses,
                deleted_reports: deleted.reports,
                sites: account.sites,
                limit: getSiteLimit(account)
            });
        }

        account.sites.splice(siteIndex, 1);
        if (account.site_key === siteKey) {
            account.site_key = account.sites[0].key;
            account.site_url = account.sites[0].url || null;
        }
        await account.save();

        res.json({
            deleted: true,
            reset: false,
            deleted_sessions: deleted.sessions,
            deleted_analyses: deleted.analyses,
            deleted_reports: deleted.reports,
            sites: account.sites,
            limit: getSiteLimit(account)
        });
    } catch (err) {
        console.error("delete site error:", err);
        res.status(500).json({ error: "could not remove website" });
    }
});

app.post("/api/bug-reports", requireAuth(), async (req, res) => {
    try {
        const clerkUserId = getAuth(req).userId;
        const account = await Account.findOne({ clerk_user_id: clerkUserId });
        if (!account) return res.status(404).json({ error: "account not found" });

        const siteKey = resolveSiteKey(req, account);
        if (!siteKey) return res.status(403).json({ error: "website not available" });

        const description = String(req.body.description || "").trim();
        const allowedCategories = new Set(["bug", "account", "billing", "suggestion", "other"]);
        const category = allowedCategories.has(req.body.category) ? req.body.category : "bug";

        if (description.length < 10) {
            return res.status(400).json({ error: "please include a little more detail" });
        }

        if (description.length > 5000) {
            return res.status(400).json({ error: "report is too long" });
        }

        const report = await BugReport.create({
            account_id: account._id,
            clerk_user_id: clerkUserId,
            site_key: siteKey,
            email: account.email,
            category,
            description,
            dashboard_section: String(req.body.dashboard_section || "").slice(0, 100),
            page_url: String(req.body.page_url || "").slice(0, 1000),
            user_agent: String(req.headers["user-agent"] || "").slice(0, 1000)
        });

        res.status(201).json({ id: report._id, created_at: report.created_at });
    } catch (err) {
        console.error("bug report error:", err);
        res.status(500).json({ error: "could not save report" });
    }
});

app.post("/api/create-checkout-session", requireAuth(), async (req, res) => {
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
        console.error("checkout error:", err);
        res.status(500).json({ error: "checkout failed" });
    }
});

app.post("/webhook/stripe", async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error("webhook signature error:", err.message);
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
                console.log(`subscription activated  key=${siteKey}  plan=${plan}`);
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
                console.log(`subscription updated  customer=${cusId}  plan=${plan}`);
                break;
            }

            case "customer.subscription.deleted":
            case "invoice.payment_failed": {
                const cusId = event.data.object.customer;
                await Account.updateOne({ stripe_customer_id: cusId }, { $set: { plan: "none" } });
                console.log(`subscription ended  customer=${cusId}`);
                break;
            }
        }
    } catch (err) {
        console.error("webhook handler error:", err);
    }

    res.json({ received: true });
});



app.get("/api/health", (req, res) => {
    const databaseReady = mongoose.connection.readyState === 1;
    res.status(databaseReady ? 200 : 503).json({ ok: databaseReady, database: databaseReady ? "connected" : "disconnected" });
});

app.get("/api/config", (req, res) => {
    res.json({
        clerk_publishable_key: process.env.CLERK_PUBLISHABLE_KEY,
        site_key: process.env.TRACETRAY_OWN_SITE_KEY || null,
        mode: TRACETRAY_MODE
    });
});


const COMMON_SECOND_LEVEL_SUFFIXES = new Set([
    "ac.uk", "co.uk", "gov.uk", "ltd.uk", "me.uk", "net.uk", "org.uk", "plc.uk",
    "asn.au", "com.au", "edu.au", "gov.au", "id.au", "net.au", "org.au",
    "ac.nz", "co.nz", "geek.nz", "gen.nz", "kiwi.nz", "maori.nz", "net.nz", "org.nz",
    "ac.jp", "co.jp", "go.jp", "ne.jp", "or.jp",
    "com.br", "net.br", "org.br",
    "com.cn", "net.cn", "org.cn",
    "co.in", "firm.in", "gen.in", "ind.in", "net.in", "org.in",
    "co.za", "net.za", "org.za",
    "com.mx", "net.mx", "org.mx",
    "com.sg", "net.sg", "org.sg",
    "com.tr", "net.tr", "org.tr"
]);

function getRegistrableDomain(hostname) {
    const normalized = String(hostname || "")
        .toLowerCase()
        .replace(/\.$/, "")
        .replace(/^www\./, "");

    if (!normalized) return null;
    if (normalized === "localhost") return normalized;
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized)) return normalized;
    if (normalized.includes(":")) return normalized;

    const labels = normalized.split(".").filter(Boolean);
    if (labels.length <= 2) return normalized;

    const finalTwo = labels.slice(-2).join(".");
    if (COMMON_SECOND_LEVEL_SUFFIXES.has(finalTwo) && labels.length >= 3) {
        return labels.slice(-3).join(".");
    }

    return finalTwo;
}

function normalizeTrackingDomain(value) {
    try {
        const url = new URL(value);
        if (!["http:", "https:"].includes(url.protocol)) return null;
        return getRegistrableDomain(url.hostname);
    } catch {
        return null;
    }
}

app.post("/collect", async (req, res) => {
    try {
        const data = req.body || {};
        const siteKey = String(data.key || "").trim();
        const sessionId = String(data.session_id || "").trim();
        const originDomain = normalizeTrackingDomain(req.headers.origin);
        const pageDomain = normalizeTrackingDomain(data.page);
        const trackingDomain = originDomain || pageDomain;

        if (!siteKey || !sessionId || !trackingDomain) return res.sendStatus(204);
        if (originDomain && pageDomain && originDomain !== pageDomain) return res.sendStatus(204);

        let account = await Account.findOne({
            $or: [{ site_key: siteKey }, { "sites.key": siteKey }]
        });

        if (!account) return res.sendStatus(204);
        await ensureAccountSites(account);

        let site = account.sites.find(item => item.key === siteKey);
        if (!site) return res.sendStatus(204);

        if (!site.domain) {
            await Account.updateOne(
                {
                    _id: account._id,
                    sites: {
                        $elemMatch: {
                            key: siteKey,
                            $or: [
                                { domain: { $exists: false } },
                                { domain: null },
                                { domain: "" }
                            ]
                        }
                    }
                },
                {
                    $set: {
                        "sites.$.domain": trackingDomain,
                        "sites.$.url": `${new URL(req.headers.origin || data.page).protocol}//${new URL(req.headers.origin || data.page).host}`
                    }
                }
            );

            account = await Account.findById(account._id);
            site = account?.sites.find(item => item.key === siteKey);
        }

        if (!site || site.domain !== trackingDomain) return res.sendStatus(204);

        const isFinal = !!data.end_time;
        isFinal
            ? console.log(`final  key=${siteKey}  session=${sessionId}  duration=${data.summary?.duration_ms}ms`)
            : console.log(`batch  key=${siteKey}  session=${sessionId}  events=${data.events?.length}`);

        await Session.updateOne(
            { site_key: siteKey, session_id: sessionId },
            {
                $set: {
                    site_key: siteKey,
                    visitor_id: data.visitor_id || null,
                    device_type: data.device_type || "desktop",
                    referrer: data.referrer || null,
                    page: data.page,
                    start_time: data.start_time,
                    end_time: data.end_time,
                    summary: data.summary
                },
                $push: { events: { $each: Array.isArray(data.events) ? data.events : [] } }
            },
            { upsert: true }
        );

        res.sendStatus(200);
    } catch (err) {
        console.error("collect error:", err);
        res.sendStatus(500);
    }
});


app.get("/api/stats", requireAuth(), async (req, res) => {
    try {
        const account = await Account.findOne({ clerk_user_id: getAuth(req).userId }).lean();
        if (!account) return res.status(404).json({ error: "account not found" });

        const siteKey = resolveSiteKey(req, account);
        if (!siteKey) return res.status(403).json({ error: "website not available" });

        const page   = req.query.page || "all";
        const filter = { site_key: siteKey };
        const pageFilter = page !== "all" ? { page } : {};

        const totalSessions = await Session.countDocuments({ ...filter, end_time: { $ne: null } });

// Mobile sessions use touch and scroll events instead of cursor movement.
        const analysableFilter = {
            ...filter, ...pageFilter, end_time: { $ne: null },
            $or: [
                { "summary.mouse_moves": { $gt: 0 } },
                { "summary.taps": { $gt: 0 } },
                { "summary.scrolls": { $gt: 0 } }
            ]
        };
        const analysableSessions = await Session.countDocuments(analysableFilter);
        const desktopSessions    = await Session.countDocuments({ ...analysableFilter, device_type: { $ne: "mobile" } });
        const mobileSessions     = await Session.countDocuments({ ...analysableFilter, device_type: "mobile" });

        const lastResult = await AnalysisResult.findOne({ ...filter, page: page !== "all" ? page : { $in: [page, null, "all"] } }).sort({ ran_at: -1 }).lean();

        const clickSummary = lastResult
            ? await getClickSummary(siteKey, 15)
            : [];

        res.json({
            total_sessions:      totalSessions,
            analysable_sessions: analysableSessions,
            desktop_sessions:    desktopSessions,
            mobile_sessions:     mobileSessions,
            last_analysis:       lastResult || null,
            plan:                account.plan,
            site_key:            siteKey,
            click_summary:       clickSummary
        });
    } catch (err) {
        console.error("stats error:", err);
        res.status(500).json({ error: "failed to fetch stats" });
    }
});

app.get("/api/sessions/recent", requireAuth(), async (req, res) => {
    try {
        const account  = await Account.findOne({ clerk_user_id: getAuth(req).userId }).lean();
        if (!account)  return res.status(404).json({ error: "account not found" });

        const siteKey = resolveSiteKey(req, account);
        if (!siteKey) return res.status(403).json({ error: "website not available" });

        const limit    = Math.min(parseInt(req.query.limit) || 20, 100);
        const sessions = await Session.find(
            { site_key: siteKey, end_time: { $ne: null } },
            { session_id:1, start_time:1, end_time:1, page:1, summary:1, device_type:1, _id:0 }
        ).sort({ start_time: -1 }).limit(limit).lean();

        res.json(sessions);
    } catch (err) {
        console.error("sessions error:", err);
        res.status(500).json({ error: "failed to fetch sessions" });
    }
});

app.get("/api/sessions/timeseries", requireAuth(), async (req, res) => {
    try {
        const account = await Account.findOne({ clerk_user_id: getAuth(req).userId }).lean();
        if (!account) return res.status(404).json({ error: "account not found" });

        const siteKey = resolveSiteKey(req, account);
        if (!siteKey) return res.status(403).json({ error: "website not available" });

        const days   = Math.min(parseInt(req.query.days) || 14, 90);
        const page   = req.query.page || null;
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

        const filter = {
            site_key: siteKey,
            end_time: { $ne: null },
            start_time: { $gte: cutoff },
            ...(page ? { page } : {})
        };

        const sessions = await Session.find(filter, { start_time: 1, device_type: 1, summary: 1, _id: 0 }).lean();

        const byDay = {};
        let engagedTotal = 0;

        for (const s of sessions) {
            const day = new Date(parseInt(s.start_time)).toISOString().slice(0, 10);
            if (!byDay[day]) byDay[day] = { date: day, desktop: 0, mobile: 0, engaged: 0 };

            const isMobile = s.device_type === "mobile";
            byDay[day][isMobile ? "mobile" : "desktop"]++;

            const engaged = (s.summary?.duration_ms || 0) > 5000 && (s.summary?.total_events || 0) > 3;
            if (engaged) { byDay[day].engaged++; engagedTotal++; }
        }

        const series = [];
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
            series.push(byDay[d] || { date: d, desktop: 0, mobile: 0, engaged: 0 });
        }

        res.json({
            series,
            total_sessions:  sessions.length,
            engaged_sessions: engagedTotal,
            engagement_rate:  sessions.length > 0 ? engagedTotal / sessions.length : 0
        });
    } catch (err) {
        console.error("timeseries error:", err);
        res.status(500).json({ error: "failed to fetch session trend" });
    }
});

// Uses session-weighted metrics because cluster labels can change between runs.
app.get("/api/ux-trends", requireAuth(), async (req, res) => {
    try {
        const account = await Account.findOne({ clerk_user_id: getAuth(req).userId }).lean();
        if (!account) return res.status(404).json({ error: "account not found" });

        const siteKey = resolveSiteKey(req, account);
        if (!siteKey) return res.status(403).json({ error: "website not available" });

        const page  = req.query.page || "all";
        const runs  = Math.min(parseInt(req.query.runs) || 10, 30);

        const results = await AnalysisResult.find({
            site_key: siteKey,
            page:     page !== "all" ? page : { $in: [page, null, "all"] },
            k:        { $gt: 0 } // skip failed/insufficient-data runs, they have no feature means
        }).sort({ ran_at: 1 }).limit(runs).lean();

        const points = results.map(r => {
            const clusters = r.clusters || [];
            const total    = clusters.reduce((s, c) => s + (c.n || 0), 0) || 1;

            function weightedAvg(key) {
                let sum = 0;
                for (const c of clusters) {
                    const v = c.feature_means?.[key];
                    if (v != null) sum += v * (c.n || 0);
                }
                return sum / total;
            }

            const hasDesktopFeatures = clusters.some(c => c.feature_means?.dwell_before_click != null);
            const hesitation = hasDesktopFeatures ? weightedAvg("dwell_before_click") : weightedAvg("dwell_before_tap");
            const readingPauses = hasDesktopFeatures ? weightedAvg("pause_rate") : weightedAvg("scroll_pause_rate");
            const scrollDepth   = hasDesktopFeatures ? weightedAvg("bottom_zone_ratio") : weightedAvg("scroll_depth_norm");

            const topClick = (r.click_summary || [])[0] || null;
            const ctr = topClick && r.session_count > 0 ? topClick.count / r.session_count : null;

            return {
                ran_at:          r.ran_at,
                session_count:   r.session_count,
                hesitation_ms:   hesitation || null,
                reading_pauses:  readingPauses || null,
                scroll_depth:    scrollDepth || null,
                ctr:             ctr,
                top_click_text:  topClick?.text || null
            };
        });

        res.json({
            page,
            points,
            has_ctr_history: points.some(p => p.ctr != null)
        });
    } catch (err) {
        console.error("ux-trends error:", err);
        res.status(500).json({ error: "failed to fetch UX trends" });
    }
});


function buildInterpretationPrompt({ clusters, kwResults, clickSummary, kRationale, sessionCount, pageUrl, firstImpression, mobileResult }) {
    const dataConfidence = sessionCount < 50
        ? "small (under 50 sessions) -- treat findings as directional, not conclusive"
        : sessionCount < 200
        ? "moderate (50-200 sessions) -- patterns are meaningful but will sharpen with more data"
        : "solid (200+ sessions) -- findings are reliable";

    const sigFeatures    = kwResults.filter(r => r.significant === "yes");
    const nonSigFeatures = kwResults.filter(r => r.significant !== "yes");
    const sigContext     = sigFeatures.length > 0
        ? sigFeatures.map(r => `  ${r.feature} (H=${r.H_statistic?.toFixed(1)}, p=${r.p_value < 0.001 ? "<0.001" : r.p_value?.toFixed(3)})`).join("\n")
        : "  none at p<0.05";
    const nonSigContext  = nonSigFeatures.map(r => r.feature).join(", ");

    const totalN = clusters.reduce((s, c) => s + (c.n || 0), 0);
    const clusterDescriptions = [...clusters]
        .sort((a, b) => b.n - a.n)
        .map(c => {
            const means = c.feature_means || {};
            const fmt   = v => (typeof v === "number" ? v.toFixed(3) : "n/a");
            const pct   = totalN > 0 ? ((c.n / totalN) * 100).toFixed(0) : 0;
            return `Cluster ${c.id} -- ${pct}% of sessions (n=${c.n}):\n` +
                `  pause_rate:          ${fmt(means.pause_rate)} pauses/sec\n` +
                `  click_rate:          ${fmt(means.click_rate)} clicks/sec\n` +
                `  move_density:        ${fmt(means.move_density)} moves/sec\n` +
                `  dwell_before_click:  ${fmt(means.dwell_before_click)} ms\n` +
                `  spatial_entropy:     ${fmt(means.spatial_entropy)} (0-2.2 scale)\n` +
                `  top_zone_ratio:      ${fmt(means.top_zone_ratio)}\n` +
                `  centre_zone_ratio:   ${fmt(means.centre_zone_ratio)}\n` +
                `  bottom_zone_ratio:   ${fmt(means.bottom_zone_ratio)}\n` +
                `  avg_cursor_velocity: ${fmt(means.avg_cursor_velocity)} px/ms`;
        }).join("\n\n");

    const clickLines = clickSummary.length > 0
        ? clickSummary.map(c => `  "${c.text}" (${c.tag}) -- ${c.count} clicks`).join("\n")
        : "  No click element data.";

    const clusterStoriesTemplate = clusters.map(c =>
        `    "${c.id}": {\n` +
        `      "headline": "4-6 word label specific to this visitor type. Not generic. Drawn from what makes this group statistically distinct.",\n` +
        `      "body": "2-3 sentences. First: what this group does on the page in plain language. Second: what that behaviour pattern tells you about their intent or mindset. Third: why this matters for the page. No em dashes. No technical terms.",\n` +
        `      "suggestions": ["[Evidence from this group] + [Specific page change] + [Why it addresses their behaviour]. No generic advice.", "Second only if clearly supported."]\n` +
        `    }`
    ).join(",\n");

    return `CRITICAL WRITING RULES -- violate any of these and the output is unusable:
1. Never use em dashes (--) or en dashes. Use a period or restructure the sentence instead. If you are about to write "--" stop and rewrite.
2. Never use technical feature names (no "spatial entropy", "pause_rate", "move_density", "zone ratio", "cluster", "dwell"). Translate to plain language.
3. Never suggest changes to the analysis pipeline or data collection. Only suggest page changes: copy, layout, design, content, calls to action.
4. Every UX suggestion must follow this structure: (a) what the visitor behaviour shows, (b) the specific design change, (c) why that change addresses the behaviour. Vague suggestions are not acceptable.
5. Be concise and direct. Cut every word that does not add meaning. The site_summary should be 2-3 tight sentences. Each cluster body should be 2 sentences maximum. Each suggestion should be one clear sentence. If you have made your point, stop.
6. Write like a confident analyst, not a consultant trying to fill a report. Say what you mean plainly.

You are a senior UX analyst interpreting web session behaviour data from TraceTray, a cursor-tracking analytics platform.

TraceTray extracts these signals from mouse movement:
- pause_rate: cursor pauses per second -- higher means more reading or hesitation
- click_rate: clicks per second -- higher means more interactive
- move_density: mouse moves per second -- higher means more active exploration
- dwell_before_click: milliseconds between last pause and a click -- higher means more deliberation before acting
- spatial_entropy: how broadly the cursor spread across the page (0=concentrated, 2.2=fully spread)
- top/centre/bottom_zone_ratio: fraction of cursor time in each vertical third of the page
- avg_cursor_velocity: cursor speed in pixels per millisecond

Sessions are grouped using KMeans clustering. Kruskal-Wallis tests determine which features statistically discriminate between groups.

DATASET
Page: ${pageUrl || "unknown"}
Sessions analysed: ${sessionCount}
Data confidence: ${dataConfidence}
k-selection basis: ${kRationale?.selection_basis || "silhouette score maximised within viable range"}

PAGE TYPE INFERENCE -- do this before interpreting anything else
Look at the URL path and the most clicked element text below. Infer what kind of page this is: homepage, pricing page, product or product listing page, checkout or cart, blog post or article, FAQ or help/docs page, about or company page, sign up or login page, or something else. Use this inference to shape your entire interpretation. The same behavioural pattern means different things on different page types:
- Low engagement and a fast exit on a FAQ or docs page often means the visitor found their answer quickly. That is a good outcome, not a problem.
- The same pattern on a pricing or checkout page usually means visitors are leaving without converting. That is worth flagging.
- High scrolling and reading depth on a blog post is expected and good. The same pattern on a checkout page may mean visitors are confused or stuck.
- Heavy clicking near the top of a product listing page suggests active browsing. The same pattern on a homepage may mean visitors cannot find what they are looking for.
State your inferred page type plainly in the dedicated field below. If the URL and click data give no useful signal, say the page type is unclear rather than guessing without basis.

STATISTICALLY SIGNIFICANT DISCRIMINATING FEATURES (p<0.05) -- base your labels primarily on these:
${sigContext}

NON-SIGNIFICANT FEATURES (do not over-weight in labels):
${nonSigContext || "none"}

CLUSTER PROFILES (sorted largest first):
${clusterDescriptions}

MOST CLICKED ELEMENTS ON THIS PAGE:
${clickLines}

FIRST IMPRESSION DATA (first 5 seconds of each session, compared against the rest of the same session):
${firstImpression && firstImpression.velocity_delta_pct != null
    ? `  Cursor velocity in the first 5 seconds is ${Math.abs(firstImpression.velocity_delta_pct).toFixed(0)}% ${firstImpression.velocity_delta_pct > 0 ? "faster" : "slower"} than the rest of the session.\n  Pauses in the first 5 seconds: ${firstImpression.early_pause_count}. Pauses in the rest of the session: ${firstImpression.rest_pause_count}.\n  Where early cursor activity concentrates: top ${(firstImpression.early_zone_breakdown.top*100).toFixed(0)}%, middle ${(firstImpression.early_zone_breakdown.middle*100).toFixed(0)}%, bottom ${(firstImpression.early_zone_breakdown.bottom*100).toFixed(0)}%.`
    : "  Not enough data to compare the first 5 seconds against the rest of the session."}

MOBILE VISITORS ON THIS PAGE (separate sessions, no cursor data -- touch and scroll signals only):
${mobileResult && mobileResult.clusters && mobileResult.clusters.length > 0
    ? (() => {
        const mTotal = mobileResult.clusters.reduce((s,c) => s+(c.n||0), 0);
        return `  ${mTotal} mobile sessions analysed, grouped into ${mobileResult.clusters.length} mobile visitor types:\n` +
            mobileResult.clusters.sort((a,b) => b.n - a.n).map(c => {
                const m = c.feature_means || {};
                const pct = mTotal > 0 ? ((c.n/mTotal)*100).toFixed(0) : 0;
                return `  - ${c.label} (${pct}% of mobile sessions, n=${c.n}): tap rate ${(m.tap_rate||0).toFixed(3)}/sec, ` +
                    `scroll depth reached ${((m.scroll_depth_norm||0)*100).toFixed(0)}% of typical, ` +
                    `scroll pause rate ${(m.scroll_pause_rate||0).toFixed(3)}/sec`;
            }).join("\n");
    })()
    : "  No mobile sessions analysed for this page yet."}

VISITOR ARCHETYPE VOCABULARY -- use as a starting point, coin new labels when data warrants:
- "Deep Reader" -- high pause rate, low velocity, concentrated spatial entropy
- "Deliberate Clicker" -- high dwell before click, moderate pause rate
- "Active Explorer" -- high move density, high click rate, high spatial entropy
- "Header Scanner" -- high top zone ratio, low engagement depth
- "Content Skimmer" -- low pause rate, high velocity, broad spatial coverage
- "Passive Visitor" -- low move density, low click rate
- "Engaged Converter" -- high click rate, moderate dwell, centre/bottom zone focus
- "Hesitant Browser" -- high dwell before click, low click rate
- "Scroll Depth Visitor" -- high bottom zone ratio relative to top
- "Navigation Focused" -- high click rate concentrated in top zone

YOUR TASK
Produce a JSON object with this exact structure. Ground every label in the statistically significant features. Be honest about uncertainty. Be specific.

{
  "page_type": "Your inferred page type in 2-4 words, e.g. 'Pricing page', 'FAQ or help page', 'Product listing page', 'Homepage', 'Checkout flow'. Use 'Unclear' if the URL and click data give no real signal.",
  "site_summary": "2-3 tight sentences. What the dominant visitor behaviour is, what it tells you about how this page is landing, and the single most important thing the data reveals. Interpret the behaviour in light of the inferred page type rather than generically. This should describe the page as a whole, primarily grounded in the desktop data since that is the larger and more detailed dataset. No padding. No em dashes.",
  "cluster_stories": {
${clusterStoriesTemplate}
  },
  "top_suggestions": [
    "Format: [What the data shows] + [Specific design change] + [Expected outcome]. Example: The majority of visitors read deeply before acting, which means your strongest conversion argument should appear in the lower half of the page where their attention actually is. Move the primary CTA and pricing to appear after your key differentiators rather than at the top.",
    "Second priority change in the same format, or omit if not clearly supported by the data."
  ],
  "data_note": "One honest sentence about what the current dataset size allows you to conclude and what requires more data.",
  "first_impression_note": "1-2 sentences interpreting the first impression data above. If cursor velocity is notably faster in the first 5 seconds, that usually means visitors are scanning or searching for something specific before settling in. If it is similar to the rest of the session, visitors orient quickly and engage right away. Be specific to the numbers given, not generic. If there is not enough data, say so plainly in one sentence.",
  "device_comparison": "2-3 sentences comparing how desktop and mobile visitors behave differently on this page, if mobile data is available. Ground this in the actual numbers (tap rate, scroll depth, scroll pauses) compared against the desktop patterns above, not generic assumptions about mobile behaviour. If mobile data is not available yet, say plainly that there is not enough mobile traffic to compare yet, in one sentence, rather than guessing."
}

Return only the JSON object. No preamble, no markdown fences.`;
}

// Click summaries use desktop sessions because mobile sessions record taps.
async function getClickSummary(siteKey, limit = 15) {
    try {
        const sessions = await Session.find(
            { site_key: siteKey, end_time: { $ne: null }, "summary.mouse_moves": { $gt: 0 } },
            { events: 1, _id: 0 }
        ).lean();

        const counts = {};
        for (const s of sessions) {
            for (const e of (s.events || [])) {
                if (e.type !== "click") continue;
                const text = (e.text || "").trim().slice(0, 40);
                if (!text) continue;
                const key = `${e.tag}::${text}`;
                if (!counts[key]) counts[key] = { text, tag: e.tag || "?", count: 0 };
                counts[key].count++;
            }
        }
        return Object.values(counts).sort((a, b) => b.count - a.count).slice(0, limit);
    } catch (err) {
        console.error("click summary error:", err);
        return [];
    }
}

async function callAI(prompt) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        console.warn("ANTHROPIC_API_KEY not set, skipping interpretation");
        return null;
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "Content-Type":      "application/json",
            "x-api-key":         apiKey,
            "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
            model:      "claude-sonnet-4-6",
            max_tokens: 2500,
            messages:   [{ role: "user", content: prompt }]
        })
    });

    if (!response.ok) throw new Error(`Anthropic API ${response.status}: ${await response.text()}`);

    const data  = await response.json();
    const text  = data.content?.find(b => b.type === "text")?.text || "";
    const clean = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    return JSON.parse(clean);
}

app.post("/api/billing-portal", requireAuth(), async (req, res) => {
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
        console.error("billing portal error:", err);
        res.status(500).json({ error: "could not open billing portal" });
    }
});


app.get("/api/pages", requireAuth(), async (req, res) => {
    try {
        const account = await Account.findOne({ clerk_user_id: getAuth(req).userId }).lean();
        if (!account) return res.status(404).json({ error: "account not found" });

        const siteKey = resolveSiteKey(req, account);
        if (!siteKey) return res.status(403).json({ error: "website not available" });

        const pages = await Session.aggregate([
            { $match: { site_key: siteKey, end_time: { $ne: null }, page: { $ne: null } } },
            { $group: {
                _id:        "$page",
                sessions:   { $sum: 1 },
                analysable: { $sum: { $cond: [
                    { $or: [
                        { $gt: ["$summary.mouse_moves", 0] },
                        { $gt: ["$summary.taps", 0] },
                        { $gt: ["$summary.scrolls", 0] }
                    ]},
                    1, 0
                ]}},
                last_seen:  { $max: "$start_time" }
            }},
            { $sort: { sessions: -1 } }
        ]);

        res.json(pages.map(p => ({
            page:       p._id,
            sessions:   p.sessions,
            analysable: p.analysable,
            last_seen:  p.last_seen
        })));
    } catch (err) {
        console.error("pages error:", err);
        res.status(500).json({ error: "failed to fetch pages" });
    }
});

app.post("/api/pages/reset", requireAuth(), async (req, res) => {
    try {
        const account = await Account.findOne({ clerk_user_id: getAuth(req).userId }).lean();
        if (!account) return res.status(404).json({ error: "account not found" });

        const siteKey = resolveSiteKey(req, account);
        if (!siteKey) return res.status(403).json({ error: "website not available" });

        const { page } = req.body;
        if (!page) return res.status(400).json({ error: "page is required" });

        const result = await Session.deleteMany({ site_key: siteKey, page });
        await AnalysisResult.deleteMany({ site_key: siteKey, page });

        res.json({ deleted_sessions: result.deletedCount });
    } catch (err) {
        console.error("page reset error:", err);
        res.status(500).json({ error: "failed to reset page history" });
    }
});

app.get("/api/journey", requireAuth(), async (req, res) => {
    try {
        const account = await Account.findOne({ clerk_user_id: getAuth(req).userId }).lean();
        if (!account) return res.status(404).json({ error: "account not found" });

        const siteKey = resolveSiteKey(req, account);
        if (!siteKey) return res.status(403).json({ error: "website not available" });

        const filter = { site_key: siteKey, end_time: { $ne: null }, visitor_id: { $ne: null } };

        const sessions = await Session.find(filter, {
            visitor_id: 1, page: 1, start_time: 1, end_time: 1, referrer: 1, summary: 1, _id: 0
        }).sort({ start_time: 1 }).lean();

        const byVisitor = {};
        for (const s of sessions) {
            if (!byVisitor[s.visitor_id]) byVisitor[s.visitor_id] = [];
            byVisitor[s.visitor_id].push(s);
        }

        const journeys = Object.values(byVisitor)
            .filter(v => v.length >= 1)
            .map(visits => visits.map(v => v.page));

        const entryCounts = {};
        for (const j of journeys) {
            entryCounts[j[0]] = (entryCounts[j[0]] || 0) + 1;
        }

        const exitCounts = {};
        for (const j of journeys) {
            const last = j[j.length - 1];
            exitCounts[last] = (exitCounts[last] || 0) + 1;
        }

        const transitions = {};
        for (const j of journeys) {
            for (let i = 0; i < j.length - 1; i++) {
                const key = `${j[i]} -> ${j[i+1]}`;
                transitions[key] = (transitions[key] || 0) + 1;
            }
        }

        const pathCounts = {};
        for (const j of journeys) {
            const path = j.slice(0, 3).join(" → ");
            pathCounts[path] = (pathCounts[path] || 0) + 1;
        }

        const totalVisitors  = Object.keys(byVisitor).length;
        const multiPageVisitors = journeys.filter(j => j.length > 1).length;

        const topEntries = Object.entries(entryCounts)
            .sort((a,b) => b[1]-a[1]).slice(0,10)
            .map(([page, count]) => ({ page, count }));

        const topExits = Object.entries(exitCounts)
            .sort((a,b) => b[1]-a[1]).slice(0,10)
            .map(([page, count]) => ({ page, count }));

        const topTransitions = Object.entries(transitions)
            .sort((a,b) => b[1]-a[1]).slice(0,15)
            .map(([path, count]) => ({ path, count }));

        const topPaths = Object.entries(pathCounts)
            .sort((a,b) => b[1]-a[1]).slice(0,10)
            .map(([path, count]) => ({ path, count }));

        res.json({
            total_visitors:       totalVisitors,
            multi_page_visitors:  multiPageVisitors,
            single_page_visitors: totalVisitors - multiPageVisitors,
            top_entries:          topEntries,
            top_exits:            topExits,
            top_transitions:      topTransitions,
            top_paths:            topPaths
        });
    } catch (err) {
        console.error("journey error:", err);
        res.status(500).json({ error: "failed to fetch journey data" });
    }
});


// Builds a desktop attention profile from cursor depth and early-session movement.
async function computeAttentionProfile(siteKey, page) {
    const sessionFilter = {
        site_key: siteKey,
        end_time: { $ne: null },
        "summary.mouse_moves": { $gt: 0 },
        ...(page ? { page } : {})
    };

    const sessions = await Session.find(sessionFilter, { events: 1, start_time: 1, _id: 0 }).lean();

    const BANDS               = 20;
    const FIRST_IMPRESSION_MS = 5000; // window counted as the start of a visit
    const bandTotals          = new Array(BANDS).fill(0);
    let   totalMoves          = 0;
    let   sessionsWithDepth   = 0;

// Compare early cursor activity with the rest of the same session.
    let earlyVelocitySum = 0, earlyVelocityCount = 0;
    let restVelocitySum  = 0, restVelocityCount  = 0;
    let earlyPauseCount  = 0, restPauseCount      = 0;
    const earlyBandTotals = new Array(BANDS).fill(0);

    function averageVelocity(points) {
        if (points.length < 2) return null;
        let distance = 0;
        for (let i = 1; i < points.length; i++) {
            const dx = points[i].x - points[i-1].x;
            const dy = points[i].y - points[i-1].y;
            distance += Math.sqrt(dx*dx + dy*dy);
        }
        return distance / points.length;
    }

    for (const session of sessions) {
        const moves = (session.events || []).filter(e => e.type === "mousemove" && e.y != null && e.x != null);
        if (moves.length === 0) continue;

        const ys     = moves.map(e => e.y);
        const minY   = Math.min(...ys);
        const maxY   = Math.max(...ys);
        const rangeY = maxY - minY || 1;

        for (const e of moves) {
            const normalisedDepth = (e.y - minY) / rangeY;
            const band             = Math.min(Math.floor(normalisedDepth * BANDS), BANDS - 1);
            bandTotals[band]++;
            totalMoves++;
        }

        sessionsWithDepth++;

        const sessionStart = session.start_time || moves[0].timestamp;
        const earlyMoves = [];
        const restMoves  = [];
        for (const e of moves) {
            const elapsed = (e.timestamp || 0) - sessionStart;
            if (elapsed <= FIRST_IMPRESSION_MS) earlyMoves.push(e); else restMoves.push(e);
        }

        const earlyVelocity = averageVelocity(earlyMoves);
        const restVelocity  = averageVelocity(restMoves);
        if (earlyVelocity != null) { earlyVelocitySum += earlyVelocity; earlyVelocityCount++; }
        if (restVelocity  != null) { restVelocitySum  += restVelocity;  restVelocityCount++;  }

        earlyPauseCount += (session.events || []).filter(e => e.type === "cursor_pause" && ((e.timestamp||0) - sessionStart) <= FIRST_IMPRESSION_MS).length;
        restPauseCount  += (session.events || []).filter(e => e.type === "cursor_pause" && ((e.timestamp||0) - sessionStart) > FIRST_IMPRESSION_MS).length;

        for (const e of earlyMoves) {
            const normalisedDepth = (e.y - minY) / rangeY;
            const band             = Math.min(Math.floor(normalisedDepth * BANDS), BANDS - 1);
            earlyBandTotals[band]++;
        }
    }

    const maxBand = Math.max(...bandTotals, 1);
    const depthProfile = bandTotals.map((count, i) => ({
        band:   i,
        depth:  i / BANDS,        // 0 = top of page, 1 = bottom
        weight: count / maxBand,
        count
    }));

    const third  = Math.floor(BANDS / 3);
    const topSum = bandTotals.slice(0, third).reduce((a,b) => a+b, 0);
    const midSum = bandTotals.slice(third, third*2).reduce((a,b) => a+b, 0);
    const botSum = bandTotals.slice(third*2).reduce((a,b) => a+b, 0);
    const total  = topSum + midSum + botSum || 1;
    const topPct = topSum/total, midPct = midSum/total, botPct = botSum/total;

    let insight;
    if (topPct > 0.5) {
        insight = `Most attention stays in the upper portion of the page. ${(topPct*100).toFixed(0)}% of cursor activity happens before visitors reach the middle.`;
    } else if (botPct > 0.4) {
        insight = `A larger than usual share of attention reaches the lower portion of the page. ${(botPct*100).toFixed(0)}% of cursor activity happens in the bottom third, suggesting visitors are scrolling through rather than stopping early.`;
    } else if (midPct === Math.max(topPct, midPct, botPct)) {
        insight = `Attention concentrates in the middle of the page. The top and bottom thirds see comparatively less cursor activity.`;
    } else {
        insight = `Attention is fairly evenly spread across the page from top to bottom.`;
    }

    const avgEarlyVelocity = earlyVelocityCount > 0 ? earlyVelocitySum / earlyVelocityCount : null;
    const avgRestVelocity  = restVelocityCount  > 0 ? restVelocitySum  / restVelocityCount  : null;

    let velocityDeltaPct = null;
    if (avgEarlyVelocity != null && avgRestVelocity != null && avgRestVelocity > 0) {
        velocityDeltaPct = ((avgEarlyVelocity - avgRestVelocity) / avgRestVelocity) * 100;
    }

    const maxEarlyBand = Math.max(...earlyBandTotals, 1);
    const earlyDepthProfile = earlyBandTotals.map((count, i) => ({
        band:   i,
        depth:  i / BANDS,
        weight: count / maxEarlyBand,
        count
    }));

    const earlyTopSum = earlyBandTotals.slice(0, third).reduce((a,b)=>a+b,0);
    const earlyMidSum = earlyBandTotals.slice(third, third*2).reduce((a,b)=>a+b,0);
    const earlyBotSum = earlyBandTotals.slice(third*2).reduce((a,b)=>a+b,0);
    const earlyTotal  = earlyTopSum + earlyMidSum + earlyBotSum || 1;

    const firstImpression = {
        window_ms:           FIRST_IMPRESSION_MS,
        early_avg_velocity:  avgEarlyVelocity,
        rest_avg_velocity:   avgRestVelocity,
        velocity_delta_pct:  velocityDeltaPct,
        early_pause_count:   earlyPauseCount,
        rest_pause_count:    restPauseCount,
        early_depth_profile: earlyDepthProfile,
        early_zone_breakdown: {
            top:    earlyTopSum / earlyTotal,
            middle: earlyMidSum / earlyTotal,
            bottom: earlyBotSum / earlyTotal
        }
    };

    return {
        depth_profile:    depthProfile,
        total_moves:      totalMoves,
        sessions:         sessionsWithDepth,
        insight,
        zone_breakdown:   { top: topPct, middle: midPct, bottom: botPct },
        first_impression: firstImpression
    };
}

app.get("/api/attention-profile", requireAuth(), async (req, res) => {
    try {
        const account = await Account.findOne({ clerk_user_id: getAuth(req).userId }).lean();
        if (!account) return res.status(404).json({ error: "account not found" });

        const siteKey = resolveSiteKey(req, account);
        if (!siteKey) return res.status(403).json({ error: "website not available" });

        const page   = req.query.page || null;
        const result = await computeAttentionProfile(siteKey, page);

        res.json(result);
    } catch (err) {
        console.error("attention profile error:", err);
        res.status(500).json({ error: "failed to generate attention profile" });
    }
});


const analysisRunning = {};
const analysisPermits = new Map();
const AI_COOLDOWN_MS = 10 * 60 * 1000;
const PAGE_REFRESH_COOLDOWN_MS = 30 * 60 * 1000;
const ALL_REFRESH_COOLDOWN_MS = 60 * 60 * 1000;
const lastAICallByIP = {};

function utcDayKey(date = new Date()) {
    return date.toISOString().slice(0, 10);
}

function createAnalysisPermit(userId, siteKey, scope, remaining) {
    const token = crypto.randomBytes(24).toString("base64url");
    analysisPermits.set(token, {
        userId,
        siteKey,
        scope,
        remaining,
        expiresAt: Date.now() + 10 * 60 * 1000
    });
    return token;
}

function consumeAnalysisPermit(token, userId, siteKey) {
    const permit = analysisPermits.get(token);
    if (!permit) return false;
    if (permit.expiresAt < Date.now()) {
        analysisPermits.delete(token);
        return false;
    }
    if (permit.userId !== userId || permit.siteKey !== siteKey || permit.remaining <= 0) {
        return false;
    }

    permit.remaining -= 1;
    if (permit.remaining <= 0) analysisPermits.delete(token);
    return true;
}

app.post("/api/analysis-permit", requireAuth(), async (req, res) => {
    try {
        const userId = getAuth(req).userId;
        const account = await Account.findOne({ clerk_user_id: userId });
        if (!account) return res.status(404).json({ error: "account not found" });

        const siteKey = resolveSiteKey(req, account);
        if (!siteKey) return res.status(403).json({ error: "website not available" });
        if (account.plan === "none") {
            return res.status(403).json({ error: "active subscription required" });
        }

        const site = account.sites.find(item => item.key === siteKey);
        if (!site) return res.status(404).json({ error: "website not found" });

        const scope = req.body.scope === "all" ? "all" : "page";
        const now = new Date();
        const nowMs = now.getTime();

        if (scope === "all") {
            const lastAll = site.last_all_refresh_at
                ? new Date(site.last_all_refresh_at).getTime()
                : 0;
            const remainingMs = ALL_REFRESH_COOLDOWN_MS - (nowMs - lastAll);

            if (remainingMs > 0) {
                return res.status(429).json({
                    error: "refresh all pages is available once per hour",
                    cooldown_remaining_ms: remainingMs
                });
            }

            const pageCount = Math.max(1, Math.min(100, Number(req.body.page_count) || 1));
            site.last_all_refresh_at = now;
            await account.save();

            return res.json({
                permit_token: createAnalysisPermit(userId, siteKey, "all", pageCount),
                scope,
                remaining_free_today: Math.max(0, 3 - (site.page_refresh_count || 0))
            });
        }

        const today = utcDayKey(now);
        if (site.refresh_day !== today) {
            site.refresh_day = today;
            site.page_refresh_count = 0;
            site.last_page_refresh_at = null;
        }

        const usedToday = site.page_refresh_count || 0;
        if (usedToday >= 3) {
            const lastPage = site.last_page_refresh_at
                ? new Date(site.last_page_refresh_at).getTime()
                : 0;
            const remainingMs = PAGE_REFRESH_COOLDOWN_MS - (nowMs - lastPage);

            if (remainingMs > 0) {
                return res.status(429).json({
                    error: "next page refresh is not ready yet",
                    cooldown_remaining_ms: remainingMs,
                    remaining_free_today: 0
                });
            }
        }

        site.page_refresh_count = usedToday + 1;
        site.last_page_refresh_at = now;
        await account.save();

        res.json({
            permit_token: createAnalysisPermit(userId, siteKey, "page", 1),
            scope,
            remaining_free_today: Math.max(0, 3 - site.page_refresh_count)
        });
    } catch (err) {
        console.error("analysis permit error:", err);
        res.status(500).json({ error: "could not start refresh" });
    }
});

app.post("/api/run-analysis", requireAuth(), async (req, res) => {
    const account = await Account.findOne({ clerk_user_id: getAuth(req).userId }).lean();
    if (!account) return res.status(404).json({ error: "account not found" });

    const siteKey = resolveSiteKey(req, account);
    if (!siteKey) return res.status(403).json({ error: "website not available" });

    if (account.plan === "none") return res.status(403).json({ error: "active subscription required" });

    const permitToken = String(req.body?.permit_token || "");
    if (!consumeAnalysisPermit(permitToken, getAuth(req).userId, siteKey)) {
        return res.status(429).json({ error: "refresh permission expired; try again" });
    }

    const pageFilter = req.body?.page || null;
    if (analysisRunning[siteKey]) return res.status(409).json({ error: "analysis already running" });

    analysisRunning[siteKey] = true;
    console.log(`starting analysis  key=${siteKey}`);

    const env = { ...process.env, TRACETRAY_SITE_KEY: siteKey, TRACETRAY_PAGE_FILTER: pageFilter || "" };

    const extractScript = path.join(__dirname, "..", "analysis", "extractFeatures.js");
    const extractProc   = spawn("node", [extractScript], { cwd: path.join(__dirname, ".."), env });

    let extractLog = "";
    extractProc.stdout.on("data", d => { extractLog += d; });
    extractProc.stderr.on("data", d => { extractLog += d; });

    function runPythonAnalysis(device) {
        return new Promise((resolve) => {
            const pyScript = path.join(__dirname, "..", "ml", "analyze.py");
            const pyProc   = spawn("python3", [pyScript, "--json-summary", "--device", device], {
                cwd: path.join(__dirname, "..", "ml"),
                env
            });

            let stdout = "", stderr = "";
            pyProc.stdout.on("data", d => { stdout += d; });
            pyProc.stderr.on("data", d => { stderr += d; });

            pyProc.on("close", (code) => {
                if (code !== 0) {
                    console.error(`python (${device}) failed:`, stderr);
                    return resolve(null);
                }
                const marker     = "TRACETRAY_RESULT:";
                const resultLine = stdout.split("\n").find(l => l.startsWith(marker));
                if (!resultLine) return resolve(null);

                try { resolve(JSON.parse(resultLine.slice(marker.length).trim())); }
                catch (e) { resolve(null); }
            });
        });
    }

    extractProc.on("close", async (extractCode) => {
        if (extractCode !== 0) {
            console.error(`extraction failed (exit ${extractCode}):`, extractLog);
            analysisRunning[siteKey] = false;
            return res.status(500).json({ error: "extraction failed", detail: extractLog.slice(0, 500) });
        }
        console.log(`extraction done (exit ${extractCode})`);

        const clusterResult = await runPythonAnalysis("desktop");

        if (!clusterResult) {
            analysisRunning[siteKey] = false;
            return res.status(500).json({ error: "clustering failed" });
        }

// Mobile analysis is optional when no mobile traffic is available.
        const mobileResult = await runPythonAnalysis("mobile");

        clusterResult.site_key = siteKey;
        clusterResult.page     = pageFilter || "all";
        clusterResult.ran_at   = new Date();

// Mobile results are stored without a separate model interpretation.
        if (mobileResult) {
            clusterResult.mobile = {
                session_count:    mobileResult.session_count,
                k:                mobileResult.k,
                silhouette_score: mobileResult.silhouette_score,
                clusters:         mobileResult.clusters,
                kruskal_wallis:   mobileResult.kruskal_wallis,
                k_rationale:      mobileResult.k_rationale,
                failure:          mobileResult.failure || null
            };
        }

        const clientIP        = getClientIP(req);
        const ipKey           = `${clientIP}::${siteKey}::${pageFilter || "all"}`;
        const lastAICall      = lastAICallByIP[ipKey] || 0;
        const msSinceLast     = Date.now() - lastAICall;
        const aiAllowed       = msSinceLast >= AI_COOLDOWN_MS;

// Save click history even when model interpretation is rate-limited.
        const clickSummary = await getClickSummary(siteKey, 15);
        clusterResult.click_summary = clickSummary;

        if (!aiAllowed) {
            console.log(`interpretation rate-limited  ip=${clientIP}  wait=${Math.ceil((AI_COOLDOWN_MS - msSinceLast)/1000)}s`);
            const prev = await AnalysisResult.findOne({ site_key: siteKey, page: pageFilter || "all", "ai_interpretation": { $ne: null } }).sort({ ran_at: -1 }).lean();
            if (prev?.ai_interpretation) clusterResult.ai_interpretation = prev.ai_interpretation;
        } else {
            try {
                const recentSess      = await Session.findOne({ site_key: siteKey, end_time: { $ne: null } }).sort({ start_time: -1 }).lean();
                const attentionResult = await computeAttentionProfile(siteKey, pageFilter || null);
                const prompt          = buildInterpretationPrompt({
                    clusters:        clusterResult.clusters || [],
                    kwResults:       clusterResult.kruskal_wallis || [],
                    clickSummary,
                    kRationale:      clusterResult.k_rationale || {},
                    sessionCount:    clusterResult.session_count || 0,
                    pageUrl:         recentSess?.page || null,
                    firstImpression: attentionResult.first_impression,
                    mobileResult:    clusterResult.mobile || null
                });
                const interpretation = await callAI(prompt);
                if (interpretation) {
                    clusterResult.ai_interpretation = interpretation;
                    lastAICallByIP[ipKey] = Date.now();
                    console.log("interpretation complete");
                }
            } catch (aiErr) {
                console.error("interpretation failed:", aiErr.message);
            }
        }

        analysisRunning[siteKey] = false;
        await AnalysisResult.create(clusterResult);
        console.log(`analysis saved  key=${siteKey}  k=${clusterResult.k}  n=${clusterResult.session_count}  mobile_n=${mobileResult?.session_count ?? 0}`);

        res.json({
            ok:                       true,
            result:                   clusterResult,
            ai_used:                  aiAllowed && !!clusterResult.ai_interpretation,
            ai_cooldown_remaining_ms: aiAllowed ? 0 : Math.max(0, AI_COOLDOWN_MS - msSinceLast),
            next_ai_allowed_in_ms:    aiAllowed ? AI_COOLDOWN_MS : Math.max(0, AI_COOLDOWN_MS - msSinceLast)
        });
    });
});


const PORT = Number(process.env.PORT) || 5000;

async function startServer() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log("Connected to MongoDB");
        app.listen(PORT, "0.0.0.0", () => console.log(`TraceTray server running on port ${PORT}`));
    } catch (err) {
        console.error("MongoDB connection failed:", err.message);
        process.exit(1);
    }
}

startServer();

const ABANDON_THRESHOLD_MS = 10 * 60 * 1000;

setInterval(async () => {
    try {
        const cutoffMs  = Date.now() - ABANDON_THRESHOLD_MS;
        const abandoned = await Session.find({ end_time: null, start_time: { $lt: cutoffMs }, "events.0": { $exists: true } });

        for (const session of abandoned) {
            const events       = session.events || [];
            const moves        = events.filter(e => e.type === "mousemove").length;
            const pauses       = events.filter(e => e.type === "cursor_pause").length;
            const clicks       = events.filter(e => e.type === "click").length;
            const scrolls      = events.filter(e => e.type === "scroll").length;
            const taps         = events.filter(e => e.type === "tap").length;
            const scrollPauses = events.filter(e => e.type === "scroll_pause").length;
            const startMs      = session.start_time ? new Date(session.start_time).getTime() : null;
            const lastTs       = events.length > 0 ? Math.max(...events.map(e => e.timestamp || 0)) : null;
            const duration_ms  = startMs && lastTs ? lastTs - startMs : null;

            await Session.updateOne(
                { session_id: session.session_id },
                { $set: { end_time: new Date(lastTs || Date.now()).toISOString(), summary: { duration_ms, total_events: events.length, mouse_moves: moves, cursor_pauses: pauses, clicks, scrolls, taps, scroll_pauses: scrollPauses } } }
            );
            if (moves === 0 && taps === 0) continue;
            console.log(`finalized abandoned session ${session.session_id}`);
        }
    } catch (err) { console.error("cleanup error:", err); }
}, 2 * 60 * 1000);
