// Cursor events carry window coordinates, so their place on the page adds the scroll position at that moment:
// `py` on newer trackers, otherwise the latest scroll event before it. Depth is 0 at the top of the page and 1
// at the bottom, or null when the page height is unknown (older visits that never scrolled).
module.exports = function cursorDepths(events, types = ["mousemove"]) {
    let scrollY = 0;
    let pageHeight = null;
    const out = [];
    for (const e of events || []) {
        if (e.type === "scroll") {
            if (typeof e.to === "number") scrollY = e.to;
            if (e.page_height > 0) pageHeight = e.page_height;
        } else if (e.type === "page_load") {
            // Earlier trackers measured page_load before layout, when the page was no taller than the window.
            if (e.measured === true && e.page_height > 0) pageHeight = e.page_height;
        } else if (types.includes(e.type) && typeof e.y === "number") {
            const py = typeof e.py === "number" ? e.py : e.y + scrollY;
            out.push({ event: e, depth: pageHeight ? Math.max(0, Math.min(1, py / pageHeight)) : null });
        }
    }
    return out;
};
