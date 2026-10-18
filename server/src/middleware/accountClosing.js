const { getAuth } = require("@clerk/express");
const { AccountDeletion } = require("../db/models");
const active = new Map();
const accountRequestsPending = id => active.has(id);

function createAccountClosing({ userId = req => getAuth(req).userId, requested = id => AccountDeletion.exists({ clerk_user_id: id }) } = {}) {
    return async (req, res, next) => {
        if (!req.path.startsWith("/api/") || ["/api/config", "/api/account-deletion"].includes(req.path)) return next();
        const id = userId(req);
        if (id) {
            active.set(id, (active.get(id) || 0) + 1);
            let finished = false;
            const finish = () => {
                if (finished) return;
                finished = true;
                const remaining = active.get(id) - 1;
                if (remaining) active.set(id, remaining); else active.delete(id);
            };
            res.once("finish", finish);
            res.once("close", finish);
        }
        if (id && await requested(id)) return res.status(410).json({ error: "Account deletion has been requested.", account_deleting: true });
        next();
    };
}
module.exports = { createAccountClosing, accountRequestsPending };
