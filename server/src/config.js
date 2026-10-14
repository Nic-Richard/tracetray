const TRACETRAY_MODE = process.env.TRACETRAY_MODE === "production" ? "production" : "beta";
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/sessionDB";
const PORT = Number(process.env.PORT) || 5000;

const MAX_SITES_PER_ACCOUNT = 5;
const PAGE_REFRESHES_PER_DAY = 10;
const PAGE_REFRESH_COOLDOWN_MS = 10 * 60 * 1000;
const ALL_REFRESH_COOLDOWN_MS = 60 * 60 * 1000;
const ABANDON_THRESHOLD_MS = 10 * 60 * 1000;
// Overview panels read raw events, so busy sites are capped to their newest sessions.
const RECENT_SESSION_LIMIT = 2000;

module.exports = {
    TRACETRAY_MODE,
    MONGODB_URI,
    PORT,
    MAX_SITES_PER_ACCOUNT,
    PAGE_REFRESHES_PER_DAY,
    PAGE_REFRESH_COOLDOWN_MS,
    ALL_REFRESH_COOLDOWN_MS,
    ABANDON_THRESHOLD_MS,
    RECENT_SESSION_LIMIT
};
