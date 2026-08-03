// Touch and scroll features for mobile sessions.

module.exports = function mobileFeatures(session) {

    const events = session.events || [];
    const taps          = events.filter(e => e.type === "tap");
    const scrolls       = events.filter(e => e.type === "scroll");
    const scrollPauses  = events.filter(e => e.type === "scroll_pause");

    const durationMs = session.end_time
        ? session.end_time - session.start_time
        : 0;
    const durationS = durationMs / 1000 || 1;

    const tapRate         = taps.length / durationS;
    const scrollPauseRate = scrollPauses.length / durationS;

    let scrollVelocity = 0;
    if (scrolls.length > 1) {
        const velocities = [];
        for (let i = 1; i < scrolls.length; i++) {
            const dt = scrolls[i].timestamp - scrolls[i - 1].timestamp;
            if (dt <= 0) continue;
            velocities.push(Math.abs(scrolls[i].delta || 0) / dt);
        }
        if (velocities.length > 0) {
            scrollVelocity = velocities.reduce((a, b) => a + b, 0) / velocities.length;
        }
    }

    // Measure hesitation between the last scroll pause and each tap.
    let dwellBeforeTap = 0;
    if (taps.length > 0 && scrollPauses.length > 0) {
        const dwells = [];
        for (const tap of taps) {
            const prevPauses = scrollPauses.filter(p => p.timestamp < tap.timestamp);
            if (prevPauses.length > 0) {
                const lastPause = prevPauses[prevPauses.length - 1];
                dwells.push(tap.timestamp - lastPause.timestamp);
            }
        }
        if (dwells.length > 0) {
            dwellBeforeTap = dwells.reduce((a, b) => a + b, 0) / dwells.length;
        }
    }

    // Dataset-level normalization happens in analyze.py.
    let maxScrollDepth = 0;
    let directionChanges = 0;
    let lastDirection = null;

    for (const s of scrolls) {
        if (typeof s.to === "number" && s.to > maxScrollDepth) {
            maxScrollDepth = s.to;
        }
        const direction = (s.delta || 0) > 0 ? "down" : (s.delta || 0) < 0 ? "up" : null;
        if (direction && lastDirection && direction !== lastDirection) {
            directionChanges++;
        }
        if (direction) lastDirection = direction;
    }

    return {
        tap_rate: tapRate,
        scroll_velocity: scrollVelocity,
        scroll_pause_rate: scrollPauseRate,
        dwell_before_tap: dwellBeforeTap,
        scroll_depth_reached: maxScrollDepth,
        scroll_direction_changes: directionChanges
    };
};
