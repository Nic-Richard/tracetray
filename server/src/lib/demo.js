// The shared demo login can try everything, but can't delete data or touch billing for everyone else.
function refuseDemo(account, res) {
    if (!account?.demo) return false;
    res.status(403).json({ error: "the demo account can't do that; sign up to try it on your own site" });
    return true;
}

module.exports = { refuseDemo };
