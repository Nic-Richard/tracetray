// Normalizes cursor density into a 3x3 grid.

module.exports = function spatialFeatures(session) {

    const moves = (session.events || []).filter(e => e.type === "mousemove");

    if (moves.length === 0) return {};

    const minX = moves.reduce((a, m) => Math.min(a, m.x), Infinity);
    const maxX = moves.reduce((a, m) => Math.max(a, m.x), -Infinity);
    const minY = moves.reduce((a, m) => Math.min(a, m.y), Infinity);
    const maxY = moves.reduce((a, m) => Math.max(a, m.y), -Infinity);

    if (maxX === minX || maxY === minY) return {};

    const rangeX = maxX - minX;
    const rangeY = maxY - minY;

    const gridSize = 3;
    const grid = {};

    for (let r = 0; r < gridSize; r++) {
        for (let c = 0; c < gridSize; c++) {
            grid[`grid_${r}_${c}`] = 0;
        }
    }

    for (const m of moves) {
        const col = Math.min(Math.floor(((m.x - minX) / rangeX) * gridSize), gridSize - 1);
        const row = Math.min(Math.floor(((m.y - minY) / rangeY) * gridSize), gridSize - 1);
        grid[`grid_${row}_${col}`]++;
    }

    return grid;
};
