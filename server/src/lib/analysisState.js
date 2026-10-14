const crypto = require("crypto");
const { PAGE_REFRESHES_PER_DAY, PAGE_REFRESH_COOLDOWN_MS, ALL_REFRESH_COOLDOWN_MS } = require("../config");

const PERMIT_IDLE_MS = 10 * 60 * 1000;

const analysisRunning = {};
const analysisPermits = new Map();

function utcDayKey(date = new Date()) {
    return date.toISOString().slice(0, 10);
}

function createAnalysisPermit(userId, siteKey, scope, remaining) {
    const now = Date.now();
    for (const [key, permit] of analysisPermits) {
        if (permit.expiresAt < now) analysisPermits.delete(key);
    }
    const token = crypto.randomBytes(24).toString("base64url");
    analysisPermits.set(token, {
        userId,
        siteKey,
        scope,
        remaining,
        expiresAt: Date.now() + PERMIT_IDLE_MS
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
    // A long refresh-all run keeps its permit while pages are still being analyzed.
    permit.expiresAt = Date.now() + PERMIT_IDLE_MS;
    if (permit.remaining <= 0) analysisPermits.delete(token);
    return true;
}

module.exports = {
    analysisRunning,
    analysisPermits,
    PAGE_REFRESHES_PER_DAY,
    PAGE_REFRESH_COOLDOWN_MS,
    ALL_REFRESH_COOLDOWN_MS,
    utcDayKey,
    createAnalysisPermit,
    consumeAnalysisPermit
};
