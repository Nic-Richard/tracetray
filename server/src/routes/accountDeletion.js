const express = require("express");
const { getAuth } = require("@clerk/express");
const { requireAuth } = require("../middleware/auth");
const { Account, AccountDeletion } = require("../db/models");
const { deletionStatus } = require("../lib/accountDeletion");
const { service } = require("../jobs/accountDeletion");
const { refuseDemo } = require("../lib/demo");
const router = express.Router();

router.get("/api/account-deletion", requireAuth(), async (req, res) => {
    res.json(deletionStatus(await AccountDeletion.findOne({ clerk_user_id: getAuth(req).userId }).lean()));
});
router.post("/api/account-deletion", requireAuth(), async (req, res) => {
    if (refuseDemo(await Account.findOne({ clerk_user_id: getAuth(req).userId }, { demo: 1 }).lean(), res)) return;
    const result = await service.request(getAuth(req).userId, req.body.confirmation);
    res.status(result.status).json(result.body);
});

module.exports = router;
