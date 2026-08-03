
module.exports = function basicFeatures(session) {

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
        total_events: events.length,
        mouse_moves: mouseMoves,
        cursor_pauses: pauses,
        clicks: clicks,
        scrolls: scrolls
    };
};
