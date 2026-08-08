const { Session } = require("../db/models");
const logger = require("./logger");

// Click summaries use desktop sessions because mobile sessions record taps.
async function getClickSummary(siteKey, page, limit = 15) {
    try {
        const pageFilter = page && page !== "all" ? { page } : {};
        const sessions = await Session.find(
            { site_key: siteKey, ...pageFilter, end_time: { $ne: null }, "summary.mouse_moves": { $gt: 0 } },
            { events: 1, _id: 0 }
        ).lean();

        const counts = {};
        for (const s of sessions) {
            for (const e of (s.events || [])) {
                if (e.type !== "click") continue;
                const text = (e.text || "").trim().slice(0, 40);
                if (!text) continue;
                const key = `${e.tag}::${text}`;
                if (!counts[key]) counts[key] = { text, tag: e.tag || "?", count: 0 };
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
