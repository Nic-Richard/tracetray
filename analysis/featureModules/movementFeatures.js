// Cursor movement and hesitation features.

module.exports = function movementFeatures(session) {

    const events = session.events || [];
    const moves = events.filter(e => e.type === "mousemove");
    const clickEvents = events.filter(e => e.type === "click");
    const pauseEvents = events.filter(e => e.type === "cursor_pause");

    let totalDistance = 0;
    for (let i = 1; i < moves.length; i++) {
        const dx = moves[i].x - moves[i - 1].x;
        const dy = moves[i].y - moves[i - 1].y;
        totalDistance += Math.sqrt(dx * dx + dy * dy);
    }

    const avgMoveInterval = moves.length > 0
        ? moves.reduce((sum, m) => sum + m.delta_t, 0) / moves.length
        : 0;

    let avgCursorVelocity = 0;
    if (moves.length > 1) {
        let velocities = [];
        for (let i = 1; i < moves.length; i++) {
            const dx = moves[i].x - moves[i - 1].x;
            const dy = moves[i].y - moves[i - 1].y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const dt = moves[i].delta_t || 1;
            velocities.push(dist / dt);
        }
        avgCursorVelocity = velocities.reduce((a, b) => a + b, 0) / velocities.length;
    }

    let dwellBeforeClick = 0;
    if (clickEvents.length > 0 && pauseEvents.length > 0) {
        const dwells = [];
        for (const click of clickEvents) {
            const prevPauses = pauseEvents.filter(p => p.timestamp < click.timestamp);
            if (prevPauses.length > 0) {
                const lastPause = prevPauses[prevPauses.length - 1];
                dwells.push(click.timestamp - lastPause.timestamp);
            }
        }
        if (dwells.length > 0) {
            dwellBeforeClick = dwells.reduce((a, b) => a + b, 0) / dwells.length;
        }
    }

    return {
        total_cursor_distance: totalDistance,
        avg_move_interval: avgMoveInterval,
        avg_cursor_velocity: avgCursorVelocity,
        dwell_before_click: dwellBeforeClick
    };
};
