const { Session } = require("../db/models");

// Builds a desktop attention profile from cursor depth and early-session movement.
async function computeAttentionProfile(siteKey, page) {
    const sessionFilter = {
        site_key: siteKey,
        end_time: { $ne: null },
        "summary.mouse_moves": { $gt: 0 },
        ...(page ? { page } : {})
    };

    const sessions = await Session.find(sessionFilter, { events: 1, start_time: 1, _id: 0 }).lean();

    const BANDS               = 20;
    const FIRST_IMPRESSION_MS = 5000; // window counted as the start of a visit
    const bandTotals          = new Array(BANDS).fill(0);
    let   totalMoves          = 0;
    let   sessionsWithDepth   = 0;

// Compare early cursor activity with the rest of the same session.
    let earlyVelocitySum = 0, earlyVelocityCount = 0;
    let restVelocitySum  = 0, restVelocityCount  = 0;
    let earlyPauseCount  = 0, restPauseCount      = 0;
    const earlyBandTotals = new Array(BANDS).fill(0);

    function averageVelocity(points) {
        if (points.length < 2) return null;
        let distance = 0;
        for (let i = 1; i < points.length; i++) {
            const dx = points[i].x - points[i-1].x;
            const dy = points[i].y - points[i-1].y;
            distance += Math.sqrt(dx*dx + dy*dy);
        }
        return distance / points.length;
    }

    for (const session of sessions) {
        const moves = (session.events || []).filter(e => e.type === "mousemove" && e.y != null && e.x != null);
        if (moves.length === 0) continue;

        const ys     = moves.map(e => e.y);
        const minY   = Math.min(...ys);
        const maxY   = Math.max(...ys);
        const rangeY = maxY - minY || 1;

        for (const e of moves) {
            const normalisedDepth = (e.y - minY) / rangeY;
            const band             = Math.min(Math.floor(normalisedDepth * BANDS), BANDS - 1);
            bandTotals[band]++;
            totalMoves++;
        }

        sessionsWithDepth++;

        const sessionStart = session.start_time || moves[0].timestamp;
        const earlyMoves = [];
        const restMoves  = [];
        for (const e of moves) {
            const elapsed = (e.timestamp || 0) - sessionStart;
            if (elapsed <= FIRST_IMPRESSION_MS) earlyMoves.push(e); else restMoves.push(e);
        }

        const earlyVelocity = averageVelocity(earlyMoves);
        const restVelocity  = averageVelocity(restMoves);
        if (earlyVelocity != null) { earlyVelocitySum += earlyVelocity; earlyVelocityCount++; }
        if (restVelocity  != null) { restVelocitySum  += restVelocity;  restVelocityCount++;  }

        earlyPauseCount += (session.events || []).filter(e => e.type === "cursor_pause" && ((e.timestamp||0) - sessionStart) <= FIRST_IMPRESSION_MS).length;
        restPauseCount  += (session.events || []).filter(e => e.type === "cursor_pause" && ((e.timestamp||0) - sessionStart) > FIRST_IMPRESSION_MS).length;

        for (const e of earlyMoves) {
            const normalisedDepth = (e.y - minY) / rangeY;
            const band             = Math.min(Math.floor(normalisedDepth * BANDS), BANDS - 1);
            earlyBandTotals[band]++;
        }
    }

    const maxBand = Math.max(...bandTotals, 1);
    const depthProfile = bandTotals.map((count, i) => ({
        band:   i,
        depth:  i / BANDS,        // 0 = top of page, 1 = bottom
        weight: count / maxBand,
        count
    }));

    const third  = Math.floor(BANDS / 3);
    const topSum = bandTotals.slice(0, third).reduce((a,b) => a+b, 0);
    const midSum = bandTotals.slice(third, third*2).reduce((a,b) => a+b, 0);
    const botSum = bandTotals.slice(third*2).reduce((a,b) => a+b, 0);
    const total  = topSum + midSum + botSum || 1;
    const topPct = topSum/total, midPct = midSum/total, botPct = botSum/total;

    let insight;
    if (topPct > 0.5) {
        insight = `Most attention stays in the upper portion of the page. ${(topPct*100).toFixed(0)}% of cursor activity happens before visitors reach the middle.`;
    } else if (botPct > 0.4) {
        insight = `A larger than usual share of attention reaches the lower portion of the page. ${(botPct*100).toFixed(0)}% of cursor activity happens in the bottom third, suggesting visitors are scrolling through rather than stopping early.`;
    } else if (midPct === Math.max(topPct, midPct, botPct)) {
        insight = `Attention concentrates in the middle of the page. The top and bottom thirds see comparatively less cursor activity.`;
    } else {
        insight = `Attention is fairly evenly spread across the page from top to bottom.`;
    }

    const avgEarlyVelocity = earlyVelocityCount > 0 ? earlyVelocitySum / earlyVelocityCount : null;
    const avgRestVelocity  = restVelocityCount  > 0 ? restVelocitySum  / restVelocityCount  : null;

    let velocityDeltaPct = null;
    if (avgEarlyVelocity != null && avgRestVelocity != null && avgRestVelocity > 0) {
        velocityDeltaPct = ((avgEarlyVelocity - avgRestVelocity) / avgRestVelocity) * 100;
    }

    const maxEarlyBand = Math.max(...earlyBandTotals, 1);
    const earlyDepthProfile = earlyBandTotals.map((count, i) => ({
        band:   i,
        depth:  i / BANDS,
        weight: count / maxEarlyBand,
        count
    }));

    const earlyTopSum = earlyBandTotals.slice(0, third).reduce((a,b)=>a+b,0);
    const earlyMidSum = earlyBandTotals.slice(third, third*2).reduce((a,b)=>a+b,0);
    const earlyBotSum = earlyBandTotals.slice(third*2).reduce((a,b)=>a+b,0);
    const earlyTotal  = earlyTopSum + earlyMidSum + earlyBotSum || 1;

    const firstImpression = {
        window_ms:           FIRST_IMPRESSION_MS,
        early_avg_velocity:  avgEarlyVelocity,
        rest_avg_velocity:   avgRestVelocity,
        velocity_delta_pct:  velocityDeltaPct,
        early_pause_count:   earlyPauseCount,
        rest_pause_count:    restPauseCount,
        early_depth_profile: earlyDepthProfile,
        early_zone_breakdown: {
            top:    earlyTopSum / earlyTotal,
            middle: earlyMidSum / earlyTotal,
            bottom: earlyBotSum / earlyTotal
        }
    };

    return {
        depth_profile:    depthProfile,
        total_moves:      totalMoves,
        sessions:         sessionsWithDepth,
        insight,
        zone_breakdown:   { top: topPct, middle: midPct, bottom: botPct },
        first_impression: firstImpression
    };
}

module.exports = { computeAttentionProfile };
