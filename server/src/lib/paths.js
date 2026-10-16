// Funnels: an ordered set of pages, such as product, cart, checkout. A journey counts as reaching a step
// once it has reached every earlier step first; other pages in between don't matter.
const crypto = require("crypto");
const { Session } = require("../db/models");
const { journeysOf, pageNames } = require("./goals");

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_STEPS = 2;
const MAX_STEPS = 6;
const CACHE_MS = 60 * 60 * 1000;
const cache = new Map();

const clean = value => typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

// Returns { path } or { error }.
function parsePath(input) {
    const name = clean(input?.name).slice(0, 60);
    const steps = (Array.isArray(input?.steps) ? input.steps : []).map(s => clean(s).slice(0, 2000)).filter(s => /^https?:\/\//.test(s));
    if (!name) return { error: "give the funnel a name" };
    if (steps.length < MIN_STEPS || steps.length > MAX_STEPS) return { error: `a funnel has ${MIN_STEPS} to ${MAX_STEPS} pages` };
    if (new Set(steps).size !== steps.length) return { error: "each page can only be one step" };
    return { path: { id: "p" + crypto.randomBytes(6).toString("base64url"), name, steps } };
}

function stepsReached(journey, steps) {
    let reached = 0;
    for (const visit of journey) {
        if (reached < steps.length && pageNames(visit).includes(steps[reached])) reached++;
    }
    return reached;
}

// Journeys over the last `days` that reached each step, overall and by the device the journey started on.
async function pathFunnel(siteKey, steps, { days = 30, now = Date.now() } = {}) {
    const key = `${siteKey}|${days}|${steps.join("|")}`;
    const hit = cache.get(key);
    if (hit && now - hit.at < CACHE_MS) return hit.value;

    const counts = steps.map(() => ({ all: 0, desktop: 0, mobile: 0 }));
    const cursor = Session.find(
        { site_key: siteKey, visitor_id: { $ne: null }, start_time: { $gte: now - days * DAY_MS } },
        { _id: 0, visitor_id: 1, page: 1, page_path: 1, device_type: 1, start_time: 1, end_time: 1 }
    ).sort({ visitor_id: 1, start_time: 1 }).lean().cursor();
    let visitor = null, visits = [];
    const flush = () => {
        for (const journey of journeysOf(visits)) {
            const device = journey[0].device_type === "mobile" ? "mobile" : "desktop";
            const reached = stepsReached(journey, steps);
            for (let i = 0; i < reached; i++) { counts[i].all++; counts[i][device]++; }
        }
    };
    for await (const s of cursor) {
        if (s.visitor_id !== visitor) { flush(); visitor = s.visitor_id; visits = []; }
        visits.push(s);
    }
    flush();

    const value = { days, steps: steps.map((page, i) => ({ page, ...counts[i] })) };
    if (cache.size > 2000) cache.clear();
    cache.set(key, { at: now, value });
    return value;
}

module.exports = { parsePath, pathFunnel, stepsReached, MAX_STEPS };
