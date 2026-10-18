const { getAuth } = require("@clerk/express");
const { AccountDeletion } = require("../db/models");

function createAccountClosing({ userId = req => getAuth(req).userId, requested = id => AccountDeletion.exists({ clerk_user_id: id }) } = {}) {
    return async (req, res, next) => {
        if (!req.path.startsWith("/api/") || ["/api/config", "/api/account-deletion"].includes(req.path)) return next();
        const id = userId(req);
        if (id && await requested(id)) return res.status(410).json({ error: "Account deletion has been requested.", account_deleting: true });
        next();
    };
}
module.exports = { createAccountClosing };
