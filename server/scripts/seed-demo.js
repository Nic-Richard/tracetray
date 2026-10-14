// Fills a local site with a month of made-up visits so the dashboard has something to show.
// docker compose exec server node scripts/seed-demo.js [site_key]
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });
const mongoose = require("mongoose");
const { MONGODB_URI } = require("../src/config");
const { Account, Session } = require("../src/db/models");
const { regroupSite } = require("../src/lib/pageDays");

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGES = ["/", "/pricing", "/docs", "/docs/install", "/blog", "/contact"];
const PRODUCTS = ["red", "blue", "oak", "linen", "brass"].flatMap(a => ["kettle", "mug", "shelf", "throw", "lamp", "rug", "vase", "pan"].map(n => `${a}-${n}`));
const CLICKS = ["Get started", "See pricing", "Add to cart", "Read more", "Contact us", "Docs"];
const REFERRERS = ["https://www.google.com/", "https://www.linkedin.com/", "", "https://news.ycombinator.com/"];

let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = list => list[Math.floor(rand() * list.length)];

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
    const origin = site.url || "https://demo.example";

    const docs = [];
    const now = Date.now();
    for (let v = 0; v < 600; v++) {
        let start = now - Math.floor(rand() * 30 * DAY_MS);
        const mobile = rand() < 0.3;
        const steps = 1 + Math.floor(rand() * 3);
        for (let step = 0; step < steps; step++) {
            const path = rand() < 0.35 ? `/products/${pick(PRODUCTS)}` : step === 0 && rand() < 0.5 ? "/" : pick(PAGES);
            const duration = 4000 + Math.floor(rand() * 90000);
            const depth = rand() ** 0.8;
            const scrollCount = 2 + Math.floor(rand() * 10);
            const scrolls = Array.from({ length: scrollCount }, (_, k) => ({
                type: "scroll", delta: rand() < 0.15 ? -200 : 300, scroll_depth: depth * ((k + 1) / scrollCount), timestamp: start + k * 1500 + Math.floor(rand() * 900)
            }));
            const events = mobile ? scrolls : [
                ...scrolls,
                ...Array.from({ length: 25 }, (_, k) => ({ type: "mousemove", x: 100 + rand() * 1100, y: rand() ** 1.4 * 2200, timestamp: start + k * (duration / 25) })),
                ...Array.from({ length: Math.floor(rand() * 4) }, (_, k) => ({ type: "cursor_pause", timestamp: start + k * 2000 })),
                ...Array.from({ length: Math.floor(rand() * 3) }, () => ({ type: "click", tag: rand() < 0.5 ? "a" : "button", text: pick(CLICKS), timestamp: start + duration * 0.7 }))
            ];
            docs.push({
                site_key: site.key, session_id: `demo-${v}-${step}`, visitor_id: `demo-visitor-${v}`,
                page: origin + path, device_type: mobile ? "mobile" : "desktop",
                referrer: step === 0 ? pick(REFERRERS) : `${origin}/`,
                start_time: start, end_time: start + duration,
                summary: mobile
                    ? { duration_ms: duration, total_events: events.length, mouse_moves: 0, taps: 1 + Math.floor(rand() * 4), scrolls: scrolls.length, clicks: 0 }
                    : { duration_ms: duration, total_events: events.length, mouse_moves: 25, clicks: events.filter(e => e.type === "click").length, scrolls: scrolls.length, taps: 0 },
                events
            });
            start += duration + 3000;
        }
    }

    await Session.deleteMany({ site_key: site.key, session_id: /^demo-/ });
    await Session.insertMany(docs);
    await regroupSite(site.key, site.page_groups || []);
    console.log(`Added ${docs.length} demo visits to ${site.name} (${site.key}).`);
    await mongoose.disconnect();
})().catch(err => {
    console.error(err.message);
    process.exit(1);
});
