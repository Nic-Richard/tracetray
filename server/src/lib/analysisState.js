const crypto = require("crypto");
const { AI_COOLDOWN_MS, PAGE_REFRESH_COOLDOWN_MS, ALL_REFRESH_COOLDOWN_MS } = require("../config");

const analysisRunning = {};
const analysisPermits = new Map();
const lastAICallByUser = {};

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

module.exports = {
    analysisRunning,
    analysisPermits,
    lastAICallByUser,
    AI_COOLDOWN_MS,
    PAGE_REFRESH_COOLDOWN_MS,
    ALL_REFRESH_COOLDOWN_MS,
    utcDayKey,
    createAnalysisPermit,
    consumeAnalysisPermit
};
