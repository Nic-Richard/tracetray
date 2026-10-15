const express = require("express");
const router = express.Router();
const { getAuth } = require("@clerk/express");
const { requireAuth } = require("../middleware/auth");
const { Account } = require("../db/models");
const { verify } = require("../lib/emailLinks");
const { EMAIL_LISTS, wantsEmail, emailAvailable } = require("../lib/emailPrefs");
const logger = require("../lib/logger");

const page = (title, body) => `<!DOCTYPE html><html lang="en-CA"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex"><title>${title} | TraceTray</title>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400..700&display=swap" rel="stylesheet"><link rel="stylesheet" href="/assets/site.css?v=3"></head>
<body><main class="center"><img src="/logo-mark.svg" width="44" height="44" alt=""><h1 style="font-size:28px">${title}</h1><p>${body}</p><p><a class="btn" href="/">TraceTray home</a></p></main></body></html>`;

const LIST_NAMES = { weekly_summary: "weekly summaries", shift_alerts: "behaviour-shift alerts" };

async function unsubscribe(req) {
    const accountId = String(req.query.a || "");
    const list = String(req.query.l || "");
    if (!EMAIL_LISTS.includes(list) || !verify(`unsubscribe:${list}`, accountId, req.query.t)) return null;
    await Account.updateOne({ _id: accountId }, { $set: { [`email_prefs.${list}`]: false } });
    logger.info(`${list} turned off by email link  account=${accountId}`);
    return list;
}

// GET from the link in the email; POST from mail apps' own one-click unsubscribe button.
router.get("/email/unsubscribe", async (req, res) => {
    try {
        const list = await unsubscribe(req);
        res.status(list ? 200 : 400).send(list
            ? page(`You won't get ${LIST_NAMES[list]}`, "You can turn them back on any time in Setup.")
            : page("That link didn't work", "It may be incomplete. You can turn these emails off in Setup instead."));
    } catch (err) {
        logger.error("unsubscribe error:", err);
        res.status(500).send(page("Something went wrong", "Try the link again, or turn these emails off in Setup."));
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
        weekly_summary: wantsEmail(account, "weekly_summary"),
        shift_alerts: wantsEmail(account, "shift_alerts"),
        available: Object.fromEntries(EMAIL_LISTS.map(list => [list, emailAvailable(account, list)]))
    });
});

router.patch("/api/email-prefs", requireAuth(), async (req, res) => {
    const changes = Object.fromEntries(EMAIL_LISTS.filter(list => typeof req.body?.[list] === "boolean").map(list => [`email_prefs.${list}`, req.body[list]]));
    if (!Object.keys(changes).length) return res.status(400).json({ error: "nothing to change" });
    const result = await Account.updateOne({ clerk_user_id: getAuth(req).userId }, { $set: changes });
    if (!result.matchedCount) return res.status(404).json({ error: "account not found" });
    res.json({ updated: Object.keys(changes).length });
});

module.exports = router;
