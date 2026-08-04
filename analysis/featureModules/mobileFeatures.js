// Touch and attention features for mobile sessions.

module.exports = function mobileFeatures(session) {
    const events = session.events || [];
    const taps = events.filter(e => e.type === "tap");
    const attentionPauses = events.filter(e => e.type === "attention_pause");

    const durationMs = session.end_time
        ? session.end_time - session.start_time
        : 0;
    const durationS = durationMs / 1000 || 1;

    const pauseDurations = attentionPauses
        .map(e => e.duration || 0)
        .filter(duration => duration > 0);

    const tapDwells = attentionPauses
        .filter(e => e.ended_by === "tap")
        .map(e => e.duration || 0)
        .filter(duration => duration > 0);

    return {
        tap_rate: taps.length / durationS,
        attention_pause_rate: attentionPauses.length / durationS,
        avg_attention_pause_ms: pauseDurations.length > 0
            ? pauseDurations.reduce((sum, duration) => sum + duration, 0) / pauseDurations.length
            : 0,
        dwell_before_tap: tapDwells.length > 0
            ? tapDwells.reduce((sum, duration) => sum + duration, 0) / tapDwells.length
            : 0
    };
};
