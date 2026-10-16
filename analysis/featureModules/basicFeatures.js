// Time the visitor was actually there: gaps between events count up to a limit, so a tab left open while
// someone walks away doesn't dilute every rate.
const MAX_IDLE_GAP_MS = 30000;

function activeMs(session) {
    const times = (session.events || []).map(e => e.timestamp).filter(t => typeof t === "number").sort((a, b) => a - b);
    let last = session.start_time, total = 0;
    for (const t of times) {
        total += Math.min(Math.max(0, t - last), MAX_IDLE_GAP_MS);
        last = Math.max(last, t);
    }
    if (session.end_time) total += Math.min(Math.max(0, session.end_time - last), MAX_IDLE_GAP_MS);
    return total;
}

function basicFeatures(session) {

    const events = session.events || [];

    const mouseMoves = events.filter(e => e.type === "mousemove").length;
    const pauses = events.filter(e => e.type === "cursor_pause").length;
    const clicks = events.filter(e => e.type === "click").length;
    const scrolls = events.filter(e => e.type === "scroll").length;

    const duration = session.end_time
        ? session.end_time - session.start_time
        : 0;

    return {
        duration_ms: duration,
        active_ms: activeMs(session),
        total_events: events.length,
        mouse_moves: mouseMoves,
        cursor_pauses: pauses,
        clicks: clicks,
        scrolls: scrolls
    };
}

module.exports = basicFeatures;
module.exports.activeMs = activeMs;
