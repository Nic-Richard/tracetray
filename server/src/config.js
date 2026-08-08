const TRACETRAY_MODE = process.env.TRACETRAY_MODE === "production" ? "production" : "beta";
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/sessionDB";
const PORT = Number(process.env.PORT) || 5000;

const MAX_SITES_PER_ACCOUNT = 5;
const AI_COOLDOWN_MS = 10 * 60 * 1000;
const PAGE_REFRESH_COOLDOWN_MS = 30 * 60 * 1000;
const ALL_REFRESH_COOLDOWN_MS = 60 * 60 * 1000;
const ABANDON_THRESHOLD_MS = 10 * 60 * 1000;

module.exports = {
    TRACETRAY_MODE,
    MONGODB_URI,
    PORT,
    MAX_SITES_PER_ACCOUNT,
    AI_COOLDOWN_MS,
    PAGE_REFRESH_COOLDOWN_MS,
    ALL_REFRESH_COOLDOWN_MS,
    ABANDON_THRESHOLD_MS
};
