// Fills a local site with a month of made-up shoppers for an outdoor gear store, so the dashboard
// has realistic groups, journeys and clicks to show.
// docker compose exec server node scripts/seed-demo.js [site_key]
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });
const mongoose = require("mongoose");
const { MONGODB_URI } = require("../src/config");
const { Account, Session } = require("../src/db/models");
const { regroupSite } = require("../src/lib/pageDays");

const DAY_MS = 24 * 60 * 60 * 1000;
const VISITORS = 3200;
const HISTORY_DAYS = 84;

const PRODUCTS = [
    "ridge-40-pack", "summit-25-daypack", "trailhead-55-pack", "cedar-2-tent", "alpine-ultralight-tent", "basecamp-4-tent",
    "pinecrest-down-jacket", "stormline-rain-shell", "fernwood-fleece", "granite-hiking-boot", "talus-trail-runner",
    "lakeshore-sleeping-bag", "ember-camp-stove", "aspen-trekking-poles", "northwind-headlamp", "riverbend-water-filter",
    "boulder-camp-chair", "spruce-hammock", "glacier-insulated-bottle", "tamarack-merino-socks", "highline-bivy",
    "kestrel-30-pack", "marmot-creek-gaiters", "foxglove-sun-hoodie"
];
const COLLECTIONS = ["hiking-packs", "tents", "jackets", "footwear", "camp-kitchen"];
const POSTS = ["how-to-pick-a-backpack", "first-overnight-hike", "layering-for-shoulder-season", "tent-care-guide", "packing-list-weekend"];
const SOURCES = [["https://www.google.com/", 42], ["https://www.instagram.com/", 18], ["", 20], ["https://www.reddit.com/", 9], ["https://mail.google.com/", 11]];

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = list => list[Math.floor(rand() * list.length)];
const weighted = list => { let r = rand() * list.reduce((s, [, w]) => s + w, 0); for (const [v, w] of list) if ((r -= w) <= 0) return v; return list[0][0]; };
const between = (a, b) => a + rand() * (b - a);

// Desktop shoppers: how long they stay, how they move, where on the page they look, what they click.
const DESKTOP = {
    buyer:    { weight: 40, duration: [25, 60], speed: [0.5, 0.9], pauses: [2, 5], depth: [0.4, 0.65], yBias: 0.9, dwell: [400, 900] },
    comparer: { weight: 35, duration: [90, 240], speed: [0.15, 0.35], pauses: [8, 18], depth: [0.75, 1], yBias: 0.55, dwell: [2000, 4200], backtrack: true },
    scanner:  { weight: 25, duration: [4, 10], speed: [1.6, 2.6], pauses: [0, 1], depth: [0.05, 0.15], yBias: 2.6, dwell: [200, 500] }
};
const PHONE = {
    tapper:  { weight: 40, duration: [20, 60], taps: [3, 7], pauses: [1, 3], pauseMs: [800, 1600], depth: [0.4, 0.7] },
    reader:  { weight: 35, duration: [80, 200], taps: [1, 3], pauses: [6, 14], pauseMs: [2500, 6000], depth: [0.8, 1] },
    bouncer: { weight: 25, duration: [4, 12], taps: [0, 1], pauses: [0, 1], pauseMs: [400, 900], depth: [0.05, 0.2] }
};

function journey() {
    const product = pick(PRODUCTS);
    const r = rand();
    if (r < 0.12) return ["/journal/" + pick(POSTS), "/products/" + product];
    if (r < 0.3) return ["/products/" + product, "/products/" + pick(PRODUCTS)];
    const path = ["/", "/collections/" + pick(COLLECTIONS), "/products/" + product];
    if (rand() < 0.35) path.push("/cart");
    if (path.includes("/cart") && rand() < 0.55) path.push("/checkout");
    return path.slice(0, 1 + Math.floor(rand() * path.length));
}

const target = text => ({ tag: rand() < 0.6 ? "BUTTON" : "A", id: null, text, href: null });

// What each kind of shopper clicks, so the demo's groups, goals and suggestions tell one consistent story.
const KIND = { buyer: "decider", tapper: "decider", comparer: "browser", reader: "browser", scanner: "leaver", bouncer: "leaver" };
function clickChoices(kind, path) {
    if (path === "/") return { decider: [["Shop hiking packs", 90], ["New arrivals", 10]], browser: [["New arrivals", 70], ["Shop hiking packs", 15], ["Journal", 15]], leaver: [["New arrivals", 1]] }[kind];
    if (path.startsWith("/products")) return { decider: [["Add to cart", 80], ["Colour: Moss", 12], ["Size: M", 8]], browser: [["Size guide", 52], ["Reviews", 40], ["Add to cart", 8]], leaver: [["Reviews", 1]] }[kind];
    if (path.startsWith("/collections")) return [["Ridge 40L Pack", 40], ["Summit 25 Daypack", 35], ["Filter: Waterproof", 25]];
    if (path === "/cart") return [["Checkout", 80], ["Remove", 20]];
    if (path === "/checkout") return [["Pay now", 1]];
    return [["Shop the gear", 1]];
}
const clickCount = kind => kind === "leaver" ? (rand() < 0.1 ? 1 : 0) : kind === "decider" ? 2 + Math.floor(rand() * 2) : 1 + Math.floor(rand() * 4);
// Where the storefront's main button sits, as a share of the page, so its clicks land on it in the demo picture.
const HERO_BUTTON = { desktop: 0.173, mobile: 0.13 };

function scrollEvents(start, durationMs, depth, pageHeight, viewport, steps, backtrack, stepPx) {
    const events = [{ type: "page_load", scroll_depth: viewport / pageHeight, page_height: pageHeight, viewport_height: viewport, measured: true, timestamp: start }];
    let y = 0;
    for (let i = 0; i < steps; i++) {
        const goal = Math.max(0, Math.min(pageHeight - viewport, depth * ((i + 1) / steps) * pageHeight - viewport));
        const to = backtrack && rand() < 0.3 ? Math.max(0, y - stepPx) : goal;
        events.push({ type: "scroll", from: y, to, delta: to - y, scroll_depth: Math.min(1, (to + viewport) / pageHeight), page_height: pageHeight, viewport_height: viewport,
            timestamp: Math.round(start + ((i + 1) / (steps + 1)) * durationMs) });
        y = to;
    }
    return events;
}

const scrollAt = (scrolls, t) => scrolls.reduce((y, e) => (e.type === "scroll" && e.timestamp <= t ? e.to : y), 0);

function desktopEvents(start, persona, path) {
    const p = DESKTOP[persona];
    const durationMs = between(...p.duration) * 1000;
    const pageHeight = path.startsWith("/products") ? 3600 : 2600;
    const viewport = 820;
    const depth = between(...p.depth);
    const events = scrollEvents(start, durationMs, Math.max(depth, viewport / pageHeight), pageHeight, viewport, Math.max(1, Math.round(depth * 12)), p.backtrack, 280);
    const scrolls = [...events];
    const moves = Math.round(durationMs / 400);
    let x = between(300, 1100);
    for (let i = 0; i < moves; i++) {
        const t = Math.round(start + (i / moves) * durationMs);
        const top = scrollAt(scrolls, t);
        x = Math.max(40, Math.min(1400, x + between(-220, 220) * p.speed[1]));
        const y = Math.round((rand() ** p.yBias) * (viewport - 40) + 20);
        events.push({ type: "mousemove", x: Math.round(x), y, py: top + y, delta_t: Math.round(400 / between(...p.speed)), timestamp: t });
    }
    const pauseCount = Math.round(between(...p.pauses));
    for (let i = 0; i < pauseCount; i++) events.push({ type: "cursor_pause", duration: Math.round(between(600, 3000)), timestamp: Math.round(start + rand() * durationMs) });
    const firstScroll = (scrolls[1]?.timestamp ?? start + durationMs) - start;
    const count = clickCount(KIND[persona]);
    for (let i = 0; i < count; i++) {
        const text = weighted(clickChoices(KIND[persona], path));
        const hero = path === "/" && text === "Shop hiking packs";
        const t = Math.round(start + (hero ? between(0.2, 0.9) * firstScroll : between(0.3, 0.95) * durationMs));
        const y = hero ? Math.round(HERO_BUTTON.desktop * pageHeight + between(-12, 12)) : Math.round(between(120, viewport - 120));
        events.push({ type: "cursor_pause", duration: Math.round(between(...p.dwell)), timestamp: t - Math.round(between(...p.dwell)) });
        events.push({ type: "click", tag: "BUTTON", text, target: target(text), x: Math.round(between(200, 1100)), y, py: scrollAt(scrolls, t) + y, timestamp: t });
    }
    return { events: events.sort((a, b) => a.timestamp - b.timestamp), durationMs };
}

function phoneEvents(start, persona, path) {
    const p = PHONE[persona];
    const durationMs = between(...p.duration) * 1000;
    const pageHeight = path.startsWith("/products") ? 5600 : 4400;
    const viewport = 760;
    const depth = between(...p.depth);
    const events = scrollEvents(start, durationMs, Math.max(depth, viewport / pageHeight), pageHeight, viewport, Math.max(1, Math.round(depth * 14)), rand() < 0.3, 300);
    const scrolls = [...events];
    const taps = Math.round(between(...p.taps));
    const pauses = Math.round(between(...p.pauses));
    for (let i = 0; i < pauses; i++) {
        const t = Math.round(start + rand() * durationMs);
        events.push({ type: "attention_pause", duration: Math.round(between(...p.pauseMs)), ended_by: i < taps ? "tap" : "scroll",
            viewport_midpoint: scrollAt(scrolls, t) + viewport / 2, page_height: pageHeight, viewport_height: viewport, timestamp: t });
    }
    const firstScroll = (scrolls[1]?.timestamp ?? start + durationMs) - start;
    const count = KIND[persona] === "leaver" ? (rand() < 0.1 ? 1 : 0) : Math.max(1, Math.min(taps, 3));
    for (let i = 0; i < count; i++) {
        const text = weighted(clickChoices(KIND[persona], path));
        const hero = path === "/" && text === "Shop hiking packs";
        const t = Math.round(start + (hero ? between(0.2, 0.9) * firstScroll : rand() * durationMs));
        const y = hero ? Math.round(HERO_BUTTON.mobile * pageHeight) : Math.round(between(100, 700));
        events.push({ type: "tap", x: Math.round(between(20, 370)), y, text, target: target(text), timestamp: t });
    }
    return { events: events.sort((a, b) => a.timestamp - b.timestamp), durationMs };
}

function isLocal(uri) {
    try { return ["mongo", "localhost", "127.0.0.1"].includes(new URL(uri).hostname); } catch { return false; }
}

(async () => {
    if (!isLocal(MONGODB_URI)) throw new Error("seed-demo only runs against a local database");
    await mongoose.connect(MONGODB_URI);

    const requested = process.argv[2];
    const account = requested
        ? await Account.findOne({ $or: [{ site_key: requested }, { "sites.key": requested }] })
        : await Account.findOne().sort({ created_at: -1 });
    if (!account) throw new Error("no account yet: sign in to the local dashboard once, then run this again");
    const site = account.sites.find(s => s.key === requested) || account.sites[0];
    const origin = site.url || "https://morrowpine.example";

    const docs = [];
    const now = Date.now();
    for (let v = 0; v < VISITORS; v++) {
        // Traffic grows over the weeks, like a store that's starting to get found.
        const daysAgo = Math.floor(HISTORY_DAYS * rand() ** 1.6);
        let start = now - daysAgo * DAY_MS - Math.floor(rand() * DAY_MS * 0.9);
        const mobile = rand() < 0.38;
        const persona = mobile ? weighted(Object.entries(PHONE).map(([k, p]) => [k, p.weight])) : weighted(Object.entries(DESKTOP).map(([k, p]) => [k, p.weight]));
        const source = weighted(SOURCES);
        const path = journey();
        path.forEach((page, step) => {
            const { events, durationMs } = mobile ? phoneEvents(start, persona, page) : desktopEvents(start, persona, page);
            const count = type => events.filter(e => e.type === type).length;
            docs.push({
                site_key: site.key, session_id: `demo-${v}-${step}`, visitor_id: `demo-visitor-${v}`,
                page: origin + page, device_type: mobile ? "mobile" : "desktop",
                referrer: step === 0 ? source : origin + path[step - 1],
                start_time: start, end_time: start + durationMs,
                summary: {
                    duration_ms: Math.round(durationMs), total_events: events.length, mouse_moves: count("mousemove"),
                    cursor_pauses: count("cursor_pause"), clicks: count("click"), scrolls: count("scroll"), taps: count("tap"),
                    attention_pauses: count("attention_pause")
                },
                events
            });
            start += durationMs + between(2000, 8000);
        });
    }

    await Session.deleteMany({ site_key: site.key, session_id: /^demo-/ });
    for (let i = 0; i < docs.length; i += 500) await Session.insertMany(docs.slice(i, i + 500));
    await regroupSite(site.key, site.page_groups || []);
    console.log(`Added ${docs.length} demo visits from ${VISITORS} shoppers to ${site.name} (${site.key}).`);
    await mongoose.disconnect();
})().catch(err => {
    console.error(err.message);
    process.exit(1);
});
