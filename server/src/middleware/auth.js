const { getAuth } = require("@clerk/express");

function requireAuth() {
    return (req, res, next) => {
        const { userId } = getAuth(req);
        if (!userId) return res.status(401).json({ error: "unauthorized" });
        next();
    };
}

module.exports = { requireAuth };
