const { Session } = require("../db/models");
const logger = require("../lib/logger");

const DAY_MS = 24 * 60 * 60 * 1000;

// Drops raw events from old sessions and keeps their summaries. Off unless RAW_EVENT_RETENTION_DAYS is set.
// Visits recorded before max_scroll_depth existed get it filled in from their events first.
async function trimOldEvents(days, now = Date.now()) {
    const result = await Session.updateMany(
        { start_time: { $lt: now - days * DAY_MS }, "events.0": { $exists: true } },
        [
            { $set: {
                max_scroll_depth: { $ifNull: ["$max_scroll_depth", { $max: { $map: { input: { $filter: { input: { $ifNull: ["$events", []] }, cond: { $eq: ["$$this.type", "scroll"] } } }, in: "$$this.scroll_depth" } } }] },
                events_trimmed_at: new Date(now)
            } },
            { $unset: "events" }
        ],
        { updatePipeline: true }
    );
    return result.modifiedCount || 0;
}

// Deletes visits entirely once they're older than SESSION_RETENTION_DAYS. Daily page counts and analysis
// results are kept, so long-term history doesn't depend on the visits themselves.
async function deleteOldSessions(days, now = Date.now()) {
    const result = await Session.deleteMany({ start_time: { $lt: now - days * DAY_MS } });
    return result.deletedCount || 0;
}

function startEventRetentionJob() {
    const days = Number(process.env.RAW_EVENT_RETENTION_DAYS);
    const sessionDays = Number(process.env.SESSION_RETENTION_DAYS);
    const trimEvents = Number.isFinite(days) && days >= 7;
    const deleteSessions = Number.isFinite(sessionDays) && sessionDays >= 90;
    if (!trimEvents && !deleteSessions) return;
    const run = async () => {
        try {
            const trimmed = trimEvents ? await trimOldEvents(days) : 0;
            if (trimmed) logger.info(`trimmed raw events from ${trimmed} sessions older than ${days} days`);
            const deleted = deleteSessions ? await deleteOldSessions(sessionDays) : 0;
            if (deleted) logger.info(`deleted ${deleted} sessions older than ${sessionDays} days`);
        } catch (err) {
            logger.error("event retention error:", err);
        }
    };
    setTimeout(run, 60 * 1000);
    setInterval(run, 6 * 60 * 60 * 1000);
}

module.exports = { startEventRetentionJob, trimOldEvents, deleteOldSessions };
