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
                max_scroll_depth: { $ifNull: ["$max_scroll_depth", { $max: "$events.scroll_depth" }] },
                events_trimmed_at: new Date(now)
            } },
            { $unset: "events" }
        ],
        { updatePipeline: true }
    );
    return result.modifiedCount || 0;
}

function startEventRetentionJob() {
    const days = Number(process.env.RAW_EVENT_RETENTION_DAYS);
    if (!Number.isFinite(days) || days < 7) return;
    const run = async () => {
        try {
            const trimmed = await trimOldEvents(days);
            if (trimmed) logger.info(`trimmed raw events from ${trimmed} sessions older than ${days} days`);
        } catch (err) {
            logger.error("event retention error:", err);
        }
    };
    setTimeout(run, 60 * 1000);
    setInterval(run, 6 * 60 * 60 * 1000);
}

module.exports = { startEventRetentionJob, trimOldEvents };
