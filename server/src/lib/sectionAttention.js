// Section and element attention from the layout recorded with a page's picture. Positions are mapped from each
// visit's page height onto the picture's by proportion.
const { Session, PageShot } = require("../db/models");
const { RECENT_SESSION_LIMIT } = require("../config");
const { mainGoalFor } = require("./goalHits");

// A section counts as seen once a third of it, or half a screen of it, has been in view.
const SEEN_SHARE = 1 / 3;
// Coming back means staying this long after returning, not scrolling past on the way somewhere else.
const RETURN_MS = 2000;
// Gaps longer than this are a visitor away from the page, not reading it.
const MAX_GAP_MS = 60000;
// Three or more clicks within a second, close together.
const RAGE_CLICKS = 3, RAGE_MS = 1000, RAGE_PX = 40;
const MIN_VISITS = 30;
const MIN_CALLOUT_SHARE = 0.03;

const median = values => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

function visitGeometry(events) {
    const load = events.find(e => e.type === "page_load" && e.page_height) || events.find(e => e.page_height);
    return load ? { pageHeight: load.page_height, viewport: load.viewport_height } : null;
}

// [start, end, window top] spans, in the visit's page pixels.
function viewSpans(session) {
    const spans = [];
    let top = 0, from = session.start_time;
    for (const e of session.events) {
        if (e.type !== "scroll" || typeof e.to !== "number") continue;
        spans.push([from, e.timestamp, top]);
        top = e.to;
        from = e.timestamp;
    }
    spans.push([from, session.end_time, top]);
    return spans;
}

function sectionTimes(session, geometry, sections, scale) {
    const ms = new Array(sections.length).fill(0), seen = new Array(sections.length).fill(false), returned = new Array(sections.length).fill(false);
    const state = new Array(sections.length).fill("never"), stay = new Array(sections.length).fill(0);
    for (const [from, to, top] of viewSpans(session)) {
        const length = Math.min(Math.max(0, to - from), MAX_GAP_MS);
        const viewTop = top * scale, viewBottom = (top + geometry.viewport) * scale;
        sections.forEach((s, i) => {
            const overlap = Math.min(viewBottom, s.bottom) - Math.max(viewTop, s.top);
            const inView = overlap > 0 && overlap >= Math.min((s.bottom - s.top) * SEEN_SHARE, (viewBottom - viewTop) / 2);
            if (inView) {
                ms[i] += length;
                seen[i] = true;
                if (state[i] === "left") { state[i] = "back"; stay[i] = 0; }
                if (state[i] === "back") {
                    stay[i] += length;
                    if (stay[i] >= RETURN_MS) returned[i] = true;
                } else state[i] = "in";
            } else if (state[i] !== "never") state[i] = "left";
        });
    }
    return { ms, seen, returned };
}

function clicksOf(session) {
    return session.events.filter(e => e.type === "click" || e.type === "tap").map(e => ({
        target: e.target || null,
        text: e.text || null,
        x: e.x,
        py: typeof e.py === "number" ? e.py : typeof e.viewport_midpoint === "number" ? e.viewport_midpoint - (e.viewport_height || 0) / 2 + e.y : null,
        timestamp: e.timestamp
    }));
}

// By text first: in a page group, a link to a spot on the same page has each page's own address.
const sameElement = (target, el) => target.text && el.text ? target.text === el.text : Boolean(target.href) && target.href === el.href;

function rageIn(clicks) {
    return clicks.some((c, i) => {
        const near = clicks.slice(i, i + RAGE_CLICKS);
        return near.length === RAGE_CLICKS && near.at(-1).timestamp - c.timestamp <= RAGE_MS
            && near.every(o => Math.abs(o.x - c.x) <= RAGE_PX && Math.abs((o.py ?? 0) - (c.py ?? 0)) <= RAGE_PX);
    });
}

function deviceAttention(sessions, shot, goal) {
    const layout = shot?.layout;
    if (!layout?.sections?.length) return null;
    const height = shot.page_height;
    const sections = layout.sections;
    const elements = layout.elements || [];
    const media = layout.media || [];
    const perSection = sections.map(() => ({ seen: 0, returned: 0, ms: [], reached: [], missed: [] }));
    const used = new Map(), dead = new Map();
    let visits = 0, reachedCount = 0;

    for (const session of sessions) {
        const geometry = visitGeometry(session.events);
        if (!geometry?.pageHeight || !geometry.viewport) continue;
        visits++;
        const scale = height / geometry.pageHeight;
        const reached = Boolean(goal && (session.goal_hits || []).includes(goal.id));
        if (reached) reachedCount++;
        const { ms, seen, returned } = sectionTimes(session, geometry, sections, scale);
        sections.forEach((_, i) => {
            if (!seen[i]) return;
            perSection[i].seen++;
            if (returned[i]) perSection[i].returned++;
            perSection[i].ms.push(ms[i]);
            (reached ? perSection[i].reached : perSection[i].missed).push(ms[i]);
        });

        const clicks = clicksOf(session);
        const usedHere = new Set(), deadHere = new Map();
        for (const click of clicks) {
            if (click.target) {
                const index = elements.findIndex(el => sameElement(click.target, el));
                if (index >= 0) usedHere.add(index);
                continue;
            }
            if (click.py == null) continue;
            const y = click.py * scale;
            const picture = media.find(m => y >= m.top && y <= m.top + m.height);
            const key = picture ? `media:${picture.name}` : `text:${click.text || ""}:${Math.round(y / 100)}`;
            if (!deadHere.has(key)) deadHere.set(key, { picture: Boolean(picture), name: picture ? picture.name : click.text, top: picture ? picture.top + picture.height / 2 : y, left: picture ? picture.left + picture.width / 2 : click.x, clicks: [] });
            deadHere.get(key).clicks.push(click);
        }
        for (const index of usedHere) used.set(index, (used.get(index) || 0) + 1);
        for (const [key, spot] of deadHere) {
            const row = dead.get(key) || { picture: spot.picture, name: spot.name, top: spot.top, left: spot.left, visits: 0, rage: 0 };
            row.visits++;
            if (rageIn(spot.clicks)) row.rage++;
            dead.set(key, row);
        }
    }
    if (visits < MIN_VISITS) return { visits, sections: [], elements: [], dead: [], callouts: [] };

    const share = n => n / visits;
    const sectionRows = sections.map((s, i) => {
        const row = perSection[i];
        const enough = row.reached.length >= MIN_VISITS && row.missed.length >= MIN_VISITS;
        return {
            name: s.name, top: s.top, bottom: s.bottom,
            reach: share(row.seen),
            seconds: row.ms.length ? Math.round(median(row.ms) / 100) / 10 : null,
            returned: row.seen ? row.returned / row.seen : 0,
            goal: goal && enough ? { reached: Math.round(median(row.reached) / 100) / 10, missed: Math.round(median(row.missed) / 100) / 10 } : null
        };
    });
    const elementRows = [...used].map(([index, count]) => ({ ...elements[index], visits: count, share: share(count) })).sort((a, b) => b.visits - a.visits);
    const deadRows = [...dead.values()].filter(d => d.visits >= 3).map(d => ({ ...d, share: share(d.visits), rage_share: d.visits ? d.rage / d.visits : 0 })).sort((a, b) => b.visits - a.visits);

    return { visits, height, goal: goal ? { name: goal.name, reached: reachedCount } : null, sections: sectionRows, elements: elementRows, dead: deadRows, callouts: callouts(sectionRows, deadRows, goal) };
}

const pct = v => `${Math.round(v * 100)}%`;

function callouts(sections, dead, goal) {
    const out = [];
    const deadTop = dead[0];
    if (deadTop && deadTop.share >= MIN_CALLOUT_SHARE) {
        const what = deadTop.picture ? `the picture “${deadTop.name}”` : deadTop.name ? `“${deadTop.name}”` : "something that isn't a button";
        out.push(`${pct(deadTop.share)} of visits clicked ${what}, which doesn't do anything${deadTop.rage_share >= 0.2 ? `; ${pct(deadTop.rage_share)} of them clicked it again and again` : ""}.`);
    }
    const gap = sections.filter(s => s.goal && s.goal.reached - s.goal.missed >= 5 && s.goal.reached >= 1.5 * s.goal.missed)
        .sort((a, b) => (b.goal.reached - b.goal.missed) - (a.goal.reached - a.goal.missed))[0];
    if (gap && goal) out.push(`Visits that reached ${goal.name} had “${gap.name}” on screen for ${gap.goal.reached} s, against ${gap.goal.missed} s for the rest. It goes with reaching it; it doesn't prove one causes the other.`);
    const unseen = sections.find(s => s.reach < 0.5);
    if (unseen) out.push(`Only ${pct(unseen.reach)} of visits get as far as “${unseen.name}”.`);
    return out.slice(0, 3);
}

async function sectionAttention(siteKey, page) {
    if (!page) return null;
    const shots = await PageShot.find({ site_key: siteKey, page, error: null, layout: { $exists: true } }, { device: 1, layout: 1, page_height: 1 }).lean();
    if (!shots.length) return null;
    const goal = await mainGoalFor(siteKey, page).catch(() => null);
    const out = {};
    for (const shot of shots) {
        const sessions = await Session.find({
            site_key: siteKey, page, end_time: { $ne: null }, detailed: { $ne: false }, events_trimmed_at: { $exists: false },
            ...(shot.device === "mobile" ? { device_type: "mobile" } : { device_type: { $ne: "mobile" } })
        }, { events: 1, start_time: 1, end_time: 1, goal_hits: 1, _id: 0 }).sort({ start_time: -1 }).limit(RECENT_SESSION_LIMIT).lean();
        out[shot.device] = deviceAttention(sessions, shot, goal);
    }
    return out;
}

module.exports = { sectionAttention, deviceAttention, sectionTimes, rageIn, callouts };
