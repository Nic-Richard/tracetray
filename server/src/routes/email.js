const express = require("express");
const router = express.Router();
const { getAuth } = require("@clerk/express");
const { requireAuth } = require("../middleware/auth");
const { Account } = require("../db/models");
const { verify } = require("../lib/emailLinks");
const { wantsWeeklySummary } = require("../jobs/weeklySummary");
const { TRACETRAY_MODE } = require("../config");
const logger = require("../lib/logger");

const page = (title, body) => `<!DOCTYPE html><html lang="en-CA"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex"><title>${title} | TraceTray</title>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400..700&display=swap" rel="stylesheet"><link rel="stylesheet" href="/assets/site.css?v=3"></head>
<body><main class="center"><img src="/logo-mark.svg" width="44" height="44" alt=""><h1 style="font-size:28px">${title}</h1><p>${body}</p><p><a class="btn" href="/">TraceTray home</a></p></main></body></html>`;

async function unsubscribe(req) {
    const accountId = String(req.query.a || "");
    if (!verify("unsubscribe", accountId, req.query.t)) return false;
    await Account.updateOne({ _id: accountId }, { $set: { "email_prefs.weekly_summary": false } });
    logger.info(`weekly summary turned off by email link  account=${accountId}`);
    return true;
}

// GET from the link in the email; POST from mail apps' own one-click unsubscribe button.
router.get("/email/unsubscribe", async (req, res) => {
    try {
        const done = await unsubscribe(req);
        res.status(done ? 200 : 400).send(done
            ? page("You won't get weekly summaries", "You can turn them back on any time in Setup.")
            : page("That link didn't work", "It may be incomplete. You can turn weekly summaries off in Setup instead."));
    } catch (err) {
        logger.error("unsubscribe error:", err);
        res.status(500).send(page("Something went wrong", "Try the link again, or turn weekly summaries off in Setup."));
    }
});

router.post("/email/unsubscribe", async (req, res) => {
    try {
        res.sendStatus(await unsubscribe(req) ? 200 : 400);
    } catch (err) {
        logger.error("unsubscribe error:", err);
        res.sendStatus(500);
    }
});

router.get("/api/email-prefs", requireAuth(), async (req, res) => {
    const account = await Account.findOne({ clerk_user_id: getAuth(req).userId }).lean();
    if (!account) return res.status(404).json({ error: "account not found" });
    res.json({
        weekly_summary: wantsWeeklySummary(account),
        weekly_summary_available: TRACETRAY_MODE !== "production" || ["pro", "enterprise"].includes(account.plan)
    });
});

router.patch("/api/email-prefs", requireAuth(), async (req, res) => {
    if (typeof req.body?.weekly_summary !== "boolean") return res.status(400).json({ error: "weekly_summary must be true or false" });
    const result = await Account.updateOne({ clerk_user_id: getAuth(req).userId }, { $set: { "email_prefs.weekly_summary": req.body.weekly_summary } });
    if (!result.matchedCount) return res.status(404).json({ error: "account not found" });
    res.json({ weekly_summary: req.body.weekly_summary });
});

module.exports = router;
