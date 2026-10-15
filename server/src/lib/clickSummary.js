const { Session } = require("../db/models");
const logger = require("./logger");
const { RECENT_SESSION_LIMIT } = require("../config");

// Click summaries use desktop sessions because mobile sessions record taps.
async function getClickSummary(siteKey, page, limit = 15) {
    try {
        const pageFilter = page && page !== "all" ? { page } : {};
        const sessions = await Session.find(
            { site_key: siteKey, ...pageFilter, end_time: { $ne: null }, events_trimmed_at: { $exists: false }, "summary.mouse_moves": { $gt: 0 } },
            { events: 1, _id: 0 }
        ).sort({ start_time: -1 }).limit(RECENT_SESSION_LIMIT).lean();

        const counts = {};
        for (const s of sessions) {
            for (const e of (s.events || [])) {
                if (e.type !== "click") continue;
                // Newer clicks name the link or button they belong to; older ones only the element itself.
                const target = e.target && typeof e.target === "object" ? e.target : null;
                const text = ((target ? target.text : e.text) || "").trim().slice(0, 40);
                if (!text) continue;
                const tag = (target ? target.tag : e.tag) || "?";
                const href = target?.href || null;
                const key = href ? `href::${href}` : `${String(tag).toLowerCase()}::${text}`;
                if (!counts[key]) counts[key] = { text, tag, href, id: target?.id || null, count: 0 };
                counts[key].count++;
            }
        }
        return Object.values(counts).sort((a, b) => b.count - a.count).slice(0, limit);
    } catch (err) {
        logger.error("click summary error:", err);
        return [];
    }
}

module.exports = { getClickSummary };
