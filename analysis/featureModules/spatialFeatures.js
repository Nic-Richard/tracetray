// Normalizes cursor density into a 3x3 grid: rows are thirds of the page, columns thirds of the cursor's
// own horizontal range.
const cursorDepths = require("./pagePosition");

module.exports = function spatialFeatures(session) {

    const placed = cursorDepths(session.events);
    const moves = placed.map(p => p.event);

    if (moves.length === 0) return {};

    const minX = moves.reduce((a, m) => Math.min(a, m.x), Infinity);
    const maxX = moves.reduce((a, m) => Math.max(a, m.x), -Infinity);
    const minY = moves.reduce((a, m) => Math.min(a, m.y), Infinity);
    const maxY = moves.reduce((a, m) => Math.max(a, m.y), -Infinity);
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY;

    // Older visits without a known page height fall back to the cursor's own vertical range.
    const onPage = placed.every(p => p.depth !== null);
    if (!onPage && rangeY === 0) return {};

    const gridSize = 3;
    const grid = {};

    for (let r = 0; r < gridSize; r++) {
        for (let c = 0; c < gridSize; c++) {
            grid[`grid_${r}_${c}`] = 0;
        }
    }

    for (const { event: m, depth } of placed) {
        const col = Math.min(Math.floor(((m.x - minX) / rangeX) * gridSize), gridSize - 1);
        const y = onPage ? depth : (m.y - minY) / rangeY;
        const row = Math.min(Math.floor(y * gridSize), gridSize - 1);
        grid[`grid_${row}_${col}`]++;
    }

    return grid;
};
