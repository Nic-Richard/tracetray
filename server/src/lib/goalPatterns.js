// Page-level facts that go with reaching a goal, from what happened before it. Each is tested with Benjamini-Hochberg
// correction and checked against the plainest explanation: longer visits simply do more of everything.
const { Session, PageShot } = require("../db/models");
const { clickMatches, formMatches } = require("./goals");
const { sectionTimes } = require("./sectionAttention");
const { sourceName } = require("./sources");
const { twoSided } = require("./pvalue");

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 90;
const LIMIT = 5000;
const MIN_EACH_SIDE = 30;
const MIN_DIFFERENCE = 0.05;
const FALSE_DISCOVERY = 0.05;
const READ_MS = 10000;
const MAX_PATTERNS = 8;
// Parts nearly every visit reaches tell the owner nothing.
const MAX_REACH = 0.9;

function sourceOf(referrer, origin) {
    const name = sourceName(referrer, origin);
    if (!name) return null;
    return name === "no referrer" ? "Came straight to the page, with no referrer" : `Came from ${name}`;
}

// The visit up to the goal: for click and form goals, everything before the final scroll that brought the goal's
// button into view. That last approach is part of reaching the goal, not something that led to it.
function beforeGoal(session, goal, reached) {
    if (!reached || goal.type === "page") return session;
    const at = session.events.findIndex(e => clickMatches(goal, e) || formMatches(goal, e));
    if (at < 0) return session;
    let end = at;
    while (end > 0 && session.events[end - 1].type !== "scroll") end--;
    if (end > 0) end--;
    const events = session.events.slice(0, end || at);
    return { ...session, events, end_time: (session.events[end || at] || session.events[at]).timestamp };
}

const sameText = (a, b) => Boolean(a && b) && a.trim().toLowerCase() === b.trim().toLowerCase();
const sectionAt = (layout, top) => layout?.sections?.find(s => top >= s.top && top < s.bottom) || null;

// The section holding the goal's own button: reaching the goal means scrolling back to it, so facts about it are circular.
function goalSection(goal, layout) {
    if (goal.type !== "click" || !layout) return null;
    const el = (layout.elements || []).find(e => (goal.match.text && sameText(e.text, goal.match.text)) || (goal.match.href && e.href === goal.match.href) || (goal.match.id && e.id === goal.match.id));
    return el ? sectionAt(layout, el.top)?.name || null : null;
}

function factsOf(session, goal, layout, origin, skipSection) {
    const facts = new Set();
    const pagePath = session.page_path || null;
    const source = sourceOf(session.referrer, origin);
    if (source) facts.add(source);
    for (const e of session.events) {
        if (e.type !== "click" && e.type !== "tap") continue;
        if (clickMatches(goal, e)) continue;
        if (e.target?.text || e.target?.href) {
            // Links to other pages are grouped by the part of the page they sit in: that part sent people away.
            const el = layout?.elements?.find(x => (e.target.text && x.text === e.target.text) || (!e.target.text && e.target.href && x.href === e.target.href));
            const leaves = e.target.tag === "A" && e.target.href?.startsWith("/") && e.target.href !== pagePath && el && sectionAt(layout, el.top);
            facts.add(leaves ? `Left through a link in “${sectionAt(layout, el.top).name}”` : `Clicked “${e.target.text || e.target.href}”`);
        }
        else {
            const py = typeof e.py === "number" ? e.py : typeof e.viewport_midpoint === "number" ? e.viewport_midpoint - (e.viewport_height || 0) / 2 + e.y : null;
            const load = session.events.find(ev => ev.page_height);
            const y = py != null && load ? py * (layout?.height || load.page_height) / load.page_height : null;
            const picture = y != null && layout?.media?.find(m => y >= m.top && y <= m.top + m.height);
            facts.add(picture ? `Clicked the picture “${picture.name}”` : "Clicked something that isn't a button");
        }
    }
    const load = session.events.find(e => e.page_height && e.viewport_height);
    if (layout?.sections?.length && load) {
        const { ms, seen, returned } = sectionTimes(session, { pageHeight: load.page_height, viewport: load.viewport_height }, layout.sections, layout.height / load.page_height);
        layout.sections.forEach((s, i) => {
            if (s.name === skipSection) return;
            if (i > 0 && seen[i]) facts.add(`Scrolled down to “${s.name}”`);
            if (ms[i] >= READ_MS) facts.add(`Had “${s.name}” on screen for ${READ_MS / 1000} s or more`);
            if (returned[i]) facts.add(`Came back to “${s.name}”`);
        });
    }
    return facts;
}

function benjaminiHochberg(rows) {
    const sorted = [...rows].sort((a, b) => a.p - b.p);
    let cutoff = -1;
    sorted.forEach((row, i) => { if (row.p <= ((i + 1) / sorted.length) * FALSE_DISCOVERY) cutoff = i; });
    return new Set(sorted.slice(0, cutoff + 1));
}

// Rate difference averaged within quarters of visit length: if the pattern mostly disappears among visits of
// similar length, length explains it.
function holdsByLength(visits, fact, raw) {
    const lengths = visits.map(v => v.ms).sort((a, b) => a - b);
    const cuts = [0.25, 0.5, 0.75].map(q => lengths[Math.floor(q * (lengths.length - 1))]);
    const stratum = ms => cuts.filter(c => ms > c).length;
    let weighted = 0, weight = 0;
    for (let s = 0; s < 4; s++) {
        const inStratum = visits.filter(v => stratum(v.ms) === s);
        const yes = inStratum.filter(v => v.facts.has(fact)), no = inStratum.filter(v => !v.facts.has(fact));
        if (yes.length < 5 || no.length < 5) continue;
        const diff = yes.filter(v => v.reached).length / yes.length - no.filter(v => v.reached).length / no.length;
        weighted += diff * inStratum.length;
        weight += inStratum.length;
    }
    if (!weight) return false;
    const adjusted = weighted / weight;
    return Math.sign(adjusted) === Math.sign(raw) && Math.abs(adjusted) >= Math.abs(raw) / 2;
}

function visitsOf(sessions, goal, layout, origin) {
    const skip = goalSection(goal, layout);
    return sessions.map(session => {
        const reached = (session.goal_hits || []).includes(goal.id);
        const before = beforeGoal(session, goal, reached);
        return { id: session.session_id, reached, ms: Math.max(0, before.end_time - before.start_time), facts: factsOf(before, goal, layout, origin, skip) };
    });
}

// Each fact's goal rate with and without it, tested against the pooled rate; empty when either side is too thin.
function factRows(visits) {
    const total = visits.length, reachedTotal = visits.filter(v => v.reached).length;
    if (reachedTotal < MIN_EACH_SIDE || total - reachedTotal < MIN_EACH_SIDE) return [];
    const counts = new Map();
    for (const v of visits) for (const fact of v.facts) {
        const row = counts.get(fact) || { fact, n: 0, hits: 0 };
        row.n++;
        if (v.reached) row.hits++;
        counts.set(fact, row);
    }
    return [...counts.values()].filter(row => row.n >= MIN_EACH_SIDE && total - row.n >= MIN_EACH_SIDE
        && !(row.fact.startsWith("Scrolled down to") && row.n / total > MAX_REACH)).map(row => {
        const withRate = row.hits / row.n, withoutRate = (reachedTotal - row.hits) / (total - row.n);
        const pooled = reachedTotal / total;
        const se = Math.sqrt(pooled * (1 - pooled) * (1 / row.n + 1 / (total - row.n)));
        return { ...row, total, reachedTotal, withRate, withoutRate, diff: withRate - withoutRate, p: se > 0 ? twoSided((withRate - withoutRate) / se) : 1 };
    });
}

const sides = row => ({ with: { visits: row.n, reached: row.hits }, without: { visits: row.total - row.n, reached: row.reachedTotal - row.hits } });

function patternsFor(sessions, goal, layout, origin) {
    const visits = visitsOf(sessions, goal, layout, origin);
    const total = visits.length, reachedTotal = visits.filter(v => v.reached).length;
    const rows = factRows(visits);
    const kept = benjaminiHochberg(rows);
    const patterns = rows.filter(row => kept.has(row) && Math.abs(row.diff) >= MIN_DIFFERENCE)
        .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, MAX_PATTERNS)
        .map(row => ({ fact: row.fact, ...sides(row), holds: holdsByLength(visits, row.fact, row.diff) }));
    return { visits: total, reached: reachedTotal, tried: rows.length, patterns };
}

/** Within each group, the fact that goes most with reaching the goal more often: what to put in that group's path.
 * Tested across all groups together at the same false discovery rate, and dropped when visit length explains it.
 * Leaving through a link can't be a lever: the visit ends there, so it never reaches the goal. */
function leversFor(sessions, groups, goal, layout, origin) {
    const visits = visitsOf(sessions, goal, layout, origin);
    const byGroup = new Map();
    for (const v of visits) {
        const id = groups[v.id];
        if (id === undefined) continue;
        if (!byGroup.has(id)) byGroup.set(id, []);
        byGroup.get(id).push(v);
    }
    const rows = [...byGroup].flatMap(([id, members]) => factRows(members).map(row => ({ ...row, id })));
    const kept = benjaminiHochberg(rows);
    const out = {};
    for (const row of rows.filter(r => kept.has(r) && r.diff >= MIN_DIFFERENCE && !r.fact.startsWith("Left through")).sort((a, b) => b.diff - a.diff)) {
        if (out[row.id] || !holdsByLength(byGroup.get(row.id), row.fact, row.diff)) continue;
        out[row.id] = { fact: row.fact, ...sides(row) };
    }
    return out;
}

/** groups: each device's visit-to-group map from this run, for the per-group levers. */
async function goalPatterns(siteKey, page, goal, origin, groups = {}) {
    if (!goal || !page) return null;
    const shots = await PageShot.find({ site_key: siteKey, page, layout: { $exists: true } }, { device: 1, layout: 1, page_height: 1 }).lean();
    const out = {};
    for (const device of ["desktop", "mobile"]) {
        const shot = shots.find(s => s.device === device);
        const sessions = await Session.find({
            site_key: siteKey, page, end_time: { $ne: null }, detailed: { $ne: false }, events_trimmed_at: { $exists: false },
            start_time: { $gte: Date.now() - WINDOW_DAYS * DAY_MS },
            ...(device === "mobile" ? { device_type: "mobile" } : { device_type: { $ne: "mobile" } })
        }, { session_id: 1, events: 1, start_time: 1, end_time: 1, goal_hits: 1, referrer: 1, page_path: 1, _id: 0 }).sort({ start_time: -1 }).limit(LIMIT).lean();
        const layout = shot && { ...shot.layout, height: shot.page_height };
        out[device] = { goal: goal.name, ...patternsFor(sessions, goal, layout, origin), levers: groups[device] ? leversFor(sessions, groups[device], goal, layout, origin) : {} };
    }
    return out;
}

module.exports = { goalPatterns, patternsFor, leversFor, sourceOf, twoSided, benjaminiHochberg };
