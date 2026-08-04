module.exports = function scrollFeatures(session) {
    const events = session.events || [];
    const scrolls = events.filter(e => e.type === "scroll");
    const pageLoad = events.find(e => e.type === "page_load");

    let maxScrollDepth = typeof pageLoad?.scroll_depth === "number" ? pageLoad.scroll_depth : 0;
    let directionChanges = 0;
    let scrollBursts = scrolls.length > 0 ? 1 : 0;
    let upwardDistance = 0;
    let downwardDistance = 0;
    let lastDirection = null;
    let lastTimestamp = null;
    const velocities = [];

    for (const scroll of scrolls) {
        if (typeof scroll.scroll_depth === "number") {
            maxScrollDepth = Math.max(maxScrollDepth, scroll.scroll_depth);
        }

        const delta = scroll.delta || 0;
        const direction = delta > 0 ? "down" : delta < 0 ? "up" : null;

        if (delta > 0) downwardDistance += delta;
        if (delta < 0) upwardDistance += Math.abs(delta);

        if (direction && lastDirection && direction !== lastDirection) {
            directionChanges++;
        }

        if (lastTimestamp !== null) {
            const dt = scroll.timestamp - lastTimestamp;
            if (dt > 600) scrollBursts++;
            if (dt > 0) velocities.push(Math.abs(delta) / dt);
        }

        if (direction) lastDirection = direction;
        lastTimestamp = scroll.timestamp;
    }

    return {
        scroll_depth_reached: Math.min(1, maxScrollDepth),
        scroll_direction_changes: directionChanges,
        scroll_bursts: scrollBursts,
        upward_scroll_distance: upwardDistance,
        downward_scroll_distance: downwardDistance,
        scroll_velocity: velocities.length > 0
            ? velocities.reduce((sum, value) => sum + value, 0) / velocities.length
            : 0
    };
};
