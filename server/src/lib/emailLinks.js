// Signed links in emails (unsubscribe) so they work without signing in and can't be guessed.
const crypto = require("crypto");

const SITE = "https://tracetray.com";

function sign(purpose, accountId) {
    const secret = process.env.EMAIL_LINK_SECRET;
    if (!secret) return null;
    return crypto.createHmac("sha256", secret).update(`${purpose}:${accountId}`).digest("base64url").slice(0, 32);
}

function verify(purpose, accountId, token) {
    const expected = sign(purpose, String(accountId || ""));
    if (!expected || typeof token !== "string" || token.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

function unsubscribeUrl(accountId) {
    const token = sign("unsubscribe", String(accountId));
    return token ? `${SITE}/email/unsubscribe?a=${accountId}&t=${token}` : null;
}

module.exports = { sign, verify, unsubscribeUrl };
