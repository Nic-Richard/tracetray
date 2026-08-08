const { Session } = require("../db/models");
const { ABANDON_THRESHOLD_MS } = require("../config");
const logger = require("../lib/logger");

function startSessionCleanupJob() {
    setInterval(async () => {
        try {
            const cutoffMs  = Date.now() - ABANDON_THRESHOLD_MS;
            const abandoned = await Session.find({
                end_time: null,
                "events.0": { $exists: true },
                $or: [
                    { updated_at: { $lt: cutoffMs } },
                    { updated_at: { $exists: false }, start_time: { $lt: cutoffMs } }
                ]
            });

            for (const session of abandoned) {
                const events       = session.events || [];
                const moves        = events.filter(e => e.type === "mousemove").length;
                const pauses       = events.filter(e => e.type === "cursor_pause").length;
                const clicks       = events.filter(e => e.type === "click").length;
                const scrolls      = events.filter(e => e.type === "scroll").length;
                const taps         = events.filter(e => e.type === "tap").length;
                const scrollPauses = events.filter(e => e.type === "scroll_pause").length;
                const attentionPauses = events.filter(e => e.type === "attention_pause").length;
                const startMs      = session.start_time ? new Date(session.start_time).getTime() : null;
                const lastTs       = events.length > 0 ? Math.max(...events.map(e => e.timestamp || 0)) : null;
                const duration_ms  = startMs && lastTs ? lastTs - startMs : null;

                await Session.updateOne(
                    { session_id: session.session_id },
                    { $set: { end_time: new Date(lastTs || Date.now()).toISOString(), summary: { duration_ms, total_events: events.length, mouse_moves: moves, cursor_pauses: pauses, clicks, scrolls, taps, scroll_pauses: scrollPauses, attention_pauses: attentionPauses } } }
                );
                if (moves === 0 && taps === 0) continue;
                logger.debug(`finalized abandoned session ${session.session_id}`);
            }
        } catch (err) { logger.error("cleanup error:", err); }
    }, 2 * 60 * 1000);
}

module.exports = { startSessionCleanupJob };
