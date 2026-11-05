// Fills a local site with three months of made-up shoppers walking the demo store's real page layouts.
// Run scripts/shoot-demo.js first. docker compose exec server node scripts/seed-demo.js [site_key]
//
// Nothing assigns a group or an outcome: behaviour and adding to cart follow from each visitor's traits and actions.
// The two designed events (a clearer size guide, an Instagram post) are mechanisms, not written-in results.
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });
const mongoose = require("mongoose");
const { MONGODB_URI } = require("../src/config");
const { Account, Session, PageShot } = require("../src/db/models");
const { regroupSite } = require("../src/lib/pageDays");

const DAY_MS = 24 * 60 * 60 * 1000;
const VISITORS = 3200;
const HISTORY_DAYS = 84;
const CHANGE_DAYS_AGO = 20;
// An Instagram post that went around brings extra, mostly casual visitors from then on.
const POST_DAYS_AGO = 16;

const PRODUCTS = [
    "ridge-40-pack", "summit-25-daypack", "trailhead-55-pack", "cedar-2-tent", "alpine-ultralight-tent", "basecamp-4-tent",
    "pinecrest-down-jacket", "stormline-rain-shell", "fernwood-fleece", "granite-hiking-boot", "talus-trail-runner",
    "lakeshore-sleeping-bag", "ember-camp-stove", "aspen-trekking-poles", "northwind-headlamp", "riverbend-water-filter",
    "boulder-camp-chair", "spruce-hammock", "glacier-insulated-bottle", "tamarack-merino-socks", "highline-bivy",
    "kestrel-30-pack", "marmot-creek-gaiters", "foxglove-sun-hoodie"
];
const COLLECTIONS = ["hiking-packs", "tents", "jackets", "footwear", "camp-kitchen"];
const POSTS = ["how-to-pick-a-backpack", "first-overnight-hike", "layering-for-shoulder-season", "tent-care-guide", "packing-list-weekend"];
// Referrer, share of visitors, and how much more or less ready to buy they arrive.
const SOURCES = [["https://www.google.com/", 42, 0], ["https://www.instagram.com/", 18, -0.8], ["", 20, 0.5], ["https://www.reddit.com/", 9, -0.3], ["https://mail.google.com/", 11, 0.8]];
// Pages without a layout in the demo store: a plain height, and the one button people use there.
const PLAIN = { "/cart": [1300, "Checkout"], "/checkout": [1500, "Pay now"], "/journal": [3200, "Shop the gear"] };

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = list => list[Math.floor(rand() * list.length)];
const weighted = list => { let r = rand() * list.reduce((s, [, w]) => s + w, 0); for (const row of list) if ((r -= row[1]) <= 0) return row; return list[0]; };
const between = (a, b) => a + rand() * (b - a);
const normal = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
const lognormal = sd => Math.exp(sd * normal());
const sigmoid = x => 1 / (1 + Math.exp(-x));
const chance = p => rand() < p;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function visitorTraits(sourceShift, returning) {
    // One shared factor makes ready buyers a little less unsure and a little quicker, as in real shops.
    const shared = normal();
    return {
        intent: sigmoid(0.9 * normal() + 0.5 * shared + sourceShift + (returning ? 0.7 : 0) - 0.3),
        unsure: clamp(0.5 + 0.22 * normal() - 0.12 * shared - (returning ? 0.15 : 0), 0, 1),
        patience: lognormal(0.45),
        speed: lognormal(0.35)
    };
}

function journey(intent) {
    const product = pick(PRODUCTS);
    const r = rand();
    if (r < 0.12) return ["/journal/" + pick(POSTS), "/products/" + product];
    if (r < 0.32) return ["/products/" + product];
    const path = ["/", "/collections/" + pick(COLLECTIONS), "/products/" + product];
    return path.slice(0, 1 + Math.floor(rand() * 3 * (0.5 + intent)));
}

const layoutFor = (layouts, page, device) => {
    const key = page === "/" ? "/" : page.startsWith("/products/") ? "/products/:product" : page.startsWith("/collections/") ? "/collections/:collection" : null;
    return key && layouts[`${key}|${device}`];
};
const find = (layout, text) => layout.elements.find(e => e.text && e.text.startsWith(text));
const targetOf = el => ({ tag: el.tag, id: el.id, text: el.text, href: el.href });

// Positions are page pixels.
function planView(page, layout, t, clearGuide) {
    const steps = [];
    if (!layout) {
        const [height, button] = PLAIN[Object.keys(PLAIN).find(p => page.startsWith(p))] || [2000, null];
        steps.push({ read: [0, height * between(0.3, 1)], secs: 6 + 20 * t.patience * rand() });
        if (button && chance(0.4 + 0.5 * t.intent)) steps.push({ click: { tag: "BUTTON", id: null, text: button, href: null, top: height * 0.4, height: 40, left: 400, width: 300 } });
        return { steps, height, bought: false };
    }
    const { sections, elements } = layout;
    const height = sections.at(-1)?.bottom || 2000;
    if (page === "/") {
        steps.push({ read: [0, sections[0]?.bottom || 600], secs: 3 + 6 * t.patience * rand() });
        if (chance(0.25 + 0.5 * t.intent)) steps.push({ click: find(layout, "Shop hiking packs") });
        else if (chance(0.5)) {
            const s = pick(sections.slice(1));
            steps.push({ read: [s.top, s.bottom], secs: 4 + 10 * t.patience * rand() });
            const links = elements.filter(e => e.top >= s.top && e.top < s.bottom && e.href);
            if (links.length && chance(0.6)) steps.push({ click: pick(links) });
        }
        return { steps, height, bought: false };
    }
    if (page.startsWith("/collections/")) {
        steps.push({ read: [0, height * between(0.4, 1)], secs: 6 + 16 * t.patience * rand() });
        if (chance(0.3)) steps.push({ click: pick(elements.filter(e => e.tag === "BUTTON")) });
        if (chance(0.45 + 0.4 * t.intent)) steps.push({ click: pick(elements.filter(e => e.href?.startsWith("/products/"))) });
        return { steps, height, bought: false };
    }
    const [top, details, reviews, others] = sections;
    steps.push({ read: [0, top.bottom], secs: 4 + 10 * t.patience * lognormal(0.4) });
    // The photo looks like it should zoom but doesn't; some click it, and a few click again when nothing happens.
    const photo = layout.media?.[0];
    if (photo && chance(0.06 + 0.12 * t.unsure)) steps.push({ click: { tag: "DIV", id: null, text: null, href: null, ...photo }, dead: true, rage: chance(0.3) });
    if (chance(0.35)) steps.push({ click: pick(elements.filter(e => e.text?.startsWith("Colour:"))) });
    let doubt = t.unsure;
    if (chance(0.08 + 0.6 * t.unsure)) {
        steps.push({ click: find(layout, "Size guide") });
        steps.push({ read: [top.top, top.bottom], secs: 3 + 12 * t.unsure * t.patience });
        doubt *= clearGuide ? 0.35 : 0.75;
    }
    if (details && chance(0.25 + 0.4 * t.unsure)) steps.push({ read: [details.top, details.bottom], secs: 3 + 8 * t.patience * rand() });
    if (reviews && chance(0.15 + 0.6 * t.unsure)) {
        steps.push({ read: [reviews.top, reviews.bottom], secs: 6 + 25 * t.unsure * t.patience * lognormal(0.3) });
        doubt *= 0.8;
        // Still unsure after the reviews: back up to look at the product again, sometimes more than once.
        for (let again = 0; again < 2 && chance(0.9 * doubt); again++) {
            steps.push({ read: [top.top, top.bottom], secs: 3 + 6 * t.patience * rand() });
            steps.push({ read: [reviews.top, reviews.bottom], secs: 3 + 8 * t.patience * rand() });
        }
    }
    if (others && chance(0.12 + 0.4 * (1 - t.intent))) steps.push({ read: [others.top, others.bottom], secs: 3 + 8 * t.patience * rand() });
    const bought = chance(sigmoid(-2.1 + 3.4 * t.intent - 3.2 * doubt));
    if (bought) steps.push({ wait: 0.4 + 5 * doubt * lognormal(0.4), click: find(layout, "Add to cart") });
    else if (others && chance(0.3)) steps.push({ click: pick(elements.filter(e => e.top >= others.top && e.href)) });
    return { steps, height, bought };
}

function desktopEvents(start, view, t) {
    const viewport = Math.round(clamp(820 + 110 * normal(), 620, 1080));
    const { height } = view;
    const events = [{ type: "page_load", scroll_depth: Math.min(1, viewport / height), page_height: height, viewport_height: viewport, measured: true, timestamp: start }];
    let now = start + 300 + 900 * rand(), y = 0, cx = between(300, 900), cy = between(150, viewport - 150);
    const scrollTo = target => {
        target = clamp(Math.round(target), 0, Math.max(0, height - viewport));
        const bursts = Math.max(1, Math.round(Math.abs(target - y) / between(250, 600)));
        for (let i = 1; i <= bursts && target !== y; i++) {
            const to = Math.round(y + (target - y) * (i / bursts));
            now += 90 + 260 * rand();
            events.push({ type: "scroll", from: y, to, delta: to - y, scroll_depth: Math.min(1, (to + viewport) / height), page_height: height, viewport_height: viewport, timestamp: Math.round(now) });
            y = to;
        }
    };
    const move = (tx, ty, ms) => {
        const n = Math.max(2, Math.round(ms / 80));
        for (let i = 1; i <= n; i++) {
            cx += (tx - cx) / (n - i + 1) + 6 * normal();
            cy += (ty - cy) / (n - i + 1) + 6 * normal();
            now += ms / n;
            events.push({ type: "mousemove", x: Math.round(clamp(cx, 2, 1278)), y: Math.round(clamp(cy, 2, viewport - 2)), py: Math.round(y + clamp(cy, 2, viewport - 2)), delta_t: Math.round(ms / n), timestamp: Math.round(now) });
        }
    };
    const pause = ms => {
        events.push({ type: "cursor_pause", duration: Math.round(ms), x: Math.round(cx), y: Math.round(cy), py: Math.round(y + cy), timestamp: Math.round(now) });
        now += ms;
    };
    for (const step of view.steps) {
        if (step.read) {
            const [from, to] = step.read;
            let left = step.secs * 1000;
            scrollTo(from - 40);
            while (left > 0) {
                const span = Math.min(left, 900 + 2600 * rand());
                if (chance(0.55)) move(between(200, 1000), between(80, viewport - 80), span * 0.4 / t.speed);
                if (chance(0.5)) pause(span * 0.6); else now += span * 0.6;
                left -= span;
                if (y + viewport < to && chance(0.45)) scrollTo(y + between(150, 450));
            }
        }
        if (step.click) {
            const el = step.click;
            scrollTo(el.top - between(0.25, 0.6) * viewport);
            const ex = el.left + el.width * between(0.2, 0.8), ey = el.top - y + el.height * between(0.3, 0.7);
            move(ex, ey, (350 + Math.hypot(ex - cx, ey - cy) * 0.9) / t.speed);
            pause((step.wait || 0.2 + 0.8 * rand()) * 1000);
            for (let i = 0; i < (step.rage ? 3 + Math.floor(rand() * 3) : 1); i++) {
                events.push({ type: "click", tag: el.tag, id: el.id, text: el.text, target: step.dead ? null : targetOf(el), x: Math.round(cx + 4 * normal()), y: Math.round(cy + 4 * normal()), py: Math.round(y + cy), timestamp: Math.round(now) });
                now += 150 + 250 * rand();
            }
        }
    }
    if (chance(0.08)) now += between(20000, 120000);
    now += 500 + 3000 * rand();
    return { events, durationMs: now - start };
}

function phoneEvents(start, view, t) {
    const viewport = Math.round(clamp(700 + 50 * normal(), 600, 800));
    const { height } = view;
    const events = [{ type: "page_load", scroll_depth: Math.min(1, viewport / height), page_height: height, viewport_height: viewport, measured: true, timestamp: start }];
    let now = start + 400 + 1200 * rand(), y = 0;
    const scrollTo = target => {
        target = clamp(Math.round(target), 0, Math.max(0, height - viewport));
        while (target !== y) {
            const to = Math.abs(target - y) < 500 ? target : Math.round(y + Math.sign(target - y) * between(250, 500));
            now += 120 + 300 * rand();
            events.push({ type: "scroll", from: y, to, delta: to - y, scroll_depth: Math.min(1, (to + viewport) / height), page_height: height, viewport_height: viewport, timestamp: Math.round(now) });
            y = to;
        }
    };
    for (const step of view.steps) {
        if (step.read) {
            scrollTo(step.read[0]);
            let left = step.secs * 1000;
            while (left > 0) {
                const ms = Math.min(left, 800 + 3500 * rand());
                events.push({ type: "attention_pause", duration: Math.round(ms), ended_by: "scroll", viewport_midpoint: y + viewport / 2, page_height: height, viewport_height: viewport, timestamp: Math.round(now) });
                now += ms + 300;
                left -= ms;
                if (y + viewport < step.read[1] && chance(0.6)) scrollTo(y + between(150, 400));
            }
        }
        if (step.click) {
            scrollTo(step.click.top - 250);
            now += (step.wait || 0.3 + rand()) * 1000;
            const el = step.click;
            const x = Math.round(el.left + el.width * between(0.2, 0.8)), ty = Math.round(clamp(el.top + el.height * between(0.3, 0.7) - y, 40, viewport - 40));
            for (let i = 0; i < (step.rage ? 3 + Math.floor(rand() * 3) : 1); i++) {
                events.push({ type: "tap", tag: el.tag, id: el.id, text: el.text, target: step.dead ? null : targetOf(el), x, y: ty, scroll_depth: Math.min(1, (y + viewport) / height), viewport_midpoint: y + viewport / 2, page_height: height, viewport_height: viewport, timestamp: Math.round(now) });
                now += 200 + 250 * rand();
            }
        }
    }
    now += 500 + 2500 * rand();
    return { events, durationMs: now - start };
}

// A visit that leaves within seconds, without scrolling: what a mistaken click or a bot looks like.
const bounce = (start, height, viewport) => ({
    events: [{ type: "page_load", scroll_depth: Math.min(1, viewport / height), page_height: height, viewport_height: viewport, measured: true, timestamp: start }],
    durationMs: between(2, 9) * 1000
});

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
    const shots = await PageShot.find({ site_key: site.key, layout: { $exists: true } }).lean();
    const layouts = Object.fromEntries(shots.map(s => [`${s.page.replace(origin, "")}|${s.device}`, { ...s.layout, height: s.page_height }]));
    if (!layouts["/products/:product|desktop"]) throw new Error("no demo page layouts yet: run scripts/shoot-demo.js first");

    const docs = [];
    const now = Date.now();
    for (let v = 0; v < VISITORS; v++) {
        // Traffic grows steadily, like a store that's starting to get found, with quieter weekends and nights.
        let daysAgo, start;
        do {
            daysAgo = Math.floor(HISTORY_DAYS * (rand() < 0.5 ? rand() : 1 - Math.sqrt(rand())));
            const hour = clamp(Math.round(14 + 4.5 * normal()), 0, 23);
            start = now - daysAgo * DAY_MS - (new Date(now).getUTCHours() - hour) * 3600000 - Math.floor(rand() * 3600000);
        } while (start > now || ([0, 6].includes(new Date(start).getUTCDay()) && chance(0.3)));
        const fromPost = daysAgo < POST_DAYS_AGO && chance(0.3);
        const mobile = chance(fromPost ? 0.85 : 0.4);
        const [referrer, , shift] = fromPost ? SOURCES[1] : weighted(SOURCES);
        const traits = visitorTraits(shift, chance(0.18));
        const clearGuide = daysAgo < CHANGE_DAYS_AGO;
        const path = journey(traits.intent);
        for (let step = 0; step < path.length; step++) {
            const page = path[step];
            const view = planView(page, layoutFor(layouts, page, mobile ? "mobile" : "desktop"), traits, clearGuide);
            // The pictured page stands in for every product; a link to itself points at this visit's own page.
            for (const step of view.steps) if (step.click?.href?.endsWith("/sample")) step.click = { ...step.click, href: page };
            const left = step === 0 && chance(0.06 + 0.1 * (1 - traits.intent));
            const { events, durationMs } = left
                ? bounce(start, view.height, mobile ? 700 : Math.round(clamp(820 + 110 * normal(), 620, 1080)))
                : mobile ? phoneEvents(start, view, traits) : desktopEvents(start, view, traits);
            const count = type => events.filter(e => e.type === type).length;
            docs.push({
                site_key: site.key, session_id: `demo-${v}-${step}`, visitor_id: `demo-visitor-${v}`,
                page: origin + page, device_type: mobile ? "mobile" : "desktop",
                referrer: step === 0 ? referrer : origin + path[step - 1],
                start_time: start, end_time: start + durationMs,
                summary: {
                    duration_ms: Math.round(durationMs), total_events: events.length, mouse_moves: count("mousemove"),
                    cursor_pauses: count("cursor_pause"), clicks: count("click"), scrolls: count("scroll"), taps: count("tap"),
                    attention_pauses: count("attention_pause")
                },
                events
            });
            start += durationMs + between(2000, 8000);
            if (left) break;
            if (view.bought && chance(0.7)) path.push("/cart", ...(chance(0.75) ? ["/checkout"] : []));
        }
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
