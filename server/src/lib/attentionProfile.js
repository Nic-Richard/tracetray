const { Session } = require("../db/models");
const { RECENT_SESSION_LIMIT } = require("../config");
const cursorDepths = require("../../../analysis/featureModules/pagePosition");

// A multiple of three, so the thirds of the page fall on band boundaries.
const BANDS = 21;
const FIRST_IMPRESSION_MS = 5000;

const zonesOf = bands => {
    const total = bands.reduce((a, b) => a + b, 0) || 1;
    const sum = (from, to) => bands.slice(from, to).reduce((a, b) => a + b, 0) / total;
    return { top: sum(0, 7), middle: sum(7, 14), bottom: sum(14, 21) };
};

function speed(moves) {
    let distance = 0, time = 0;
    for (let i = 1; i < moves.length; i++) {
        const dt = moves[i].timestamp - moves[i - 1].timestamp;
        if (!(dt > 0) || dt > 1000) continue;
        distance += Math.hypot(moves[i].x - moves[i - 1].x, moves[i].y - moves[i - 1].y);
        time += dt;
    }
    return time > 0 ? distance / time : null;
}

function attentionInsight({ top, middle, bottom }) {
    const ranked = [["top", top], ["middle", middle], ["bottom", bottom]].sort((a, b) => b[1] - a[1]);
    const [lead, share] = ranked[0];
    const [quiet, quietShare] = ranked[2];
    const p = v => `${Math.round(v * 100)}%`;
    if (share >= 0.5 && share >= ranked[1][1] * 1.25) {
        if (lead === "top") return `Most cursor activity stays near the top: ${p(share)} happens in the top third of the page, so many visitors don't go much further.`;
        if (lead === "middle") return `Cursor activity gathers in the middle of the page, with ${p(share)} in the middle third.`;
        return `Visitors spend much of their time low on the page: ${p(share)} of cursor activity is in the bottom third.`;
    }
    if (quietShare < 0.01) return `Almost no cursor activity reaches the ${quiet} third of the page.`;
    if (quietShare < 0.12) return `The ${quiet} third of the page gets little attention: only ${p(quietShare)} of cursor activity happens there.`;
    return "Cursor activity is spread fairly evenly from the top of the page to the bottom.";
}

// Where desktop visitors' cursors spend time on the page, each visit counting equally, and how the first five
// seconds compare with the rest of the visit.
async function computeAttentionProfile(siteKey, page) {
    const sessions = await Session.find({
        site_key: siteKey,
        end_time: { $ne: null },
        detailed: { $ne: false },
        events_trimmed_at: { $exists: false },
        "summary.mouse_moves": { $gt: 0 },
        ...(page ? { page } : {})
    }, { events: 1, start_time: 1, end_time: 1, _id: 0 }).sort({ start_time: -1 }).limit(RECENT_SESSION_LIMIT).lean();

    const bands = new Array(BANDS).fill(0);
    const earlyBands = new Array(BANDS).fill(0);
    let visits = 0, totalMoves = 0;
    let earlySpeedSum = 0, restSpeedSum = 0, speedVisits = 0;
    let earlyPauses = 0, earlySeconds = 0, restPauses = 0, restSeconds = 0;

    for (const session of sessions) {
        const placed = cursorDepths(session.events).filter(p => p.depth !== null);
        if (placed.length === 0) continue;
        const start = session.start_time;
        const duration = Math.max(0, session.end_time - start);

        const own = new Array(BANDS).fill(0), ownEarly = new Array(BANDS).fill(0);
        for (const { event, depth } of placed) {
            const band = Math.min(Math.floor(depth * BANDS), BANDS - 1);
            own[band]++;
            if (event.timestamp - start <= FIRST_IMPRESSION_MS) ownEarly[band]++;
        }
        own.forEach((count, i) => { bands[i] += count / placed.length; });
        const earlyCount = ownEarly.reduce((a, b) => a + b, 0);
        if (earlyCount) ownEarly.forEach((count, i) => { earlyBands[i] += count / earlyCount; });
        visits++;
        totalMoves += placed.length;

        const moves = placed.map(p => p.event);
        const early = speed(moves.filter(m => m.timestamp - start <= FIRST_IMPRESSION_MS));
        const rest = speed(moves.filter(m => m.timestamp - start > FIRST_IMPRESSION_MS));
        if (early !== null && rest !== null) { earlySpeedSum += early; restSpeedSum += rest; speedVisits++; }

        // Pauses are compared per second, since the first five seconds are a small part of most visits.
        if (duration > FIRST_IMPRESSION_MS * 2) {
            for (const e of session.events || []) {
                if (e.type !== "cursor_pause") continue;
                if (e.timestamp - start <= FIRST_IMPRESSION_MS) earlyPauses++; else restPauses++;
            }
            earlySeconds += FIRST_IMPRESSION_MS / 1000;
            restSeconds += (duration - FIRST_IMPRESSION_MS) / 1000;
        }
    }

    const maxBand = Math.max(...bands, 1e-9);
    const zones = zonesOf(bands);
    const enoughSpeed = speedVisits >= 5;
    const enoughPauses = earlySeconds >= 25 && restSeconds > 0;

    return {
        depth_profile: bands.map((weight, i) => ({ band: i, depth: i / BANDS, weight: weight / maxBand, share: visits ? weight / visits : 0 })),
        total_moves: totalMoves,
        sessions: visits,
        insight: visits ? attentionInsight(zones) : null,
        zone_breakdown: zones,
        first_impression: {
            window_ms: FIRST_IMPRESSION_MS,
            velocity_delta_pct: enoughSpeed && restSpeedSum > 0 ? ((earlySpeedSum - restSpeedSum) / restSpeedSum) * 100 : null,
            early_pauses_per_min: enoughPauses ? (earlyPauses / earlySeconds) * 60 : null,
            rest_pauses_per_min: enoughPauses ? (restPauses / restSeconds) * 60 : null,
            early_zone_breakdown: earlyBands.some(b => b > 0) ? zonesOf(earlyBands) : null
        }
    };
}

module.exports = { computeAttentionProfile, attentionInsight };
