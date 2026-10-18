const crypto = require("crypto");
const dns = require("dns").promises;
const fs = require("fs");
const net = require("net");
const path = require("path");
const { Account, Session, PageShot } = require("../db/models");
const logger = require("./logger");

const SHOT_DIR = process.env.PAGESHOT_DIR || path.join(__dirname, "..", "..", "..", "shots");
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_AGE_MS = 7 * DAY_MS;
const UNVIEWED_DAYS = 60;
const MAX_HEIGHT = 12000;
const MAX_QUEUE = 25;
const CAPTURE_TIMEOUT_MS = 60000;
const IDLE_CLOSE_MS = 60000;
const DEVICES = {
    desktop: { width: 1280, height: 800, deviceScaleFactor: 0.75, isMobile: false },
    mobile: { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true }
};
const SKIPPED_TYPES = new Set(["media", "websocket", "eventsource", "manifest"]);
// The site's own TraceTray tracker would record every picture as a visit.
const TRACKER = /\/client\/tracker\.js|\/collect(\?|$)/;

const hostChecks = new Map();

function privateAddress(ip) {
    if (net.isIPv4(ip)) {
        const [a, b] = ip.split(".").map(Number);
        return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
    }
    const v6 = ip.toLowerCase();
    if (v6.startsWith("::ffff:")) return privateAddress(v6.slice(7));
    return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

// Site domains are owner-typed, so without this a picture could reach the server's own network.
async function publicUrl(raw) {
    if (process.env.PAGESHOT_ALLOW_PRIVATE === "1") return true;
    let url;
    try { url = new URL(raw); } catch { return false; }
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const known = hostChecks.get(url.hostname);
    if (known && Date.now() - known.at < 10 * 60 * 1000) return known.ok;
    let ok = false;
    try {
        const addresses = await dns.lookup(url.hostname, { all: true });
        ok = addresses.length > 0 && addresses.every(a => !privateAddress(a.address));
    } catch {}
    if (hostChecks.size > 5000) hostChecks.clear();
    hostChecks.set(url.hostname, { ok, at: Date.now() });
    return ok;
}

async function addressFor(siteKey, page) {
    if (!page.includes("/:")) return page;
    const [row] = await Session.aggregate([
        { $match: { site_key: siteKey, page, page_path: { $ne: null }, start_time: { $gte: Date.now() - 30 * 24 * 60 * 60 * 1000 } } },
        { $group: { _id: "$page_path", n: { $sum: 1 } } },
        { $sort: { n: -1 } },
        { $limit: 1 }
    ]);
    return row ? new URL(row._id, page).href : null;
}

let browserPromise = null, idleTimer = null;
function browser() {
    clearTimeout(idleTimer);
    if (!browserPromise) {
        const puppeteer = require("puppeteer-core");
        browserPromise = puppeteer.launch({
            executablePath: process.env.PAGESHOT_BROWSER || "/usr/bin/chromium",
            headless: true,
            args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-extensions", "--disable-background-networking",
                "--disable-default-apps", "--disable-sync", "--no-first-run", "--hide-scrollbars", "--mute-audio"]
        }).catch(err => { browserPromise = null; throw err; });
    }
    return browserPromise;
}

async function closeBrowser() {
    const running = browserPromise;
    browserPromise = null;
    if (running) await running.then(b => b.close()).catch(() => {});
}

async function capture(address, device) {
    const tab = await (await browser()).newPage();
    try {
        await tab.setViewport(DEVICES[device]);
        if (device === "mobile") await tab.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1");
        await tab.setRequestInterception(true);
        tab.on("request", request => {
            const url = request.url();
            if (url.startsWith("data:")) return request.continue();
            if (SKIPPED_TYPES.has(request.resourceType()) || TRACKER.test(url)) return request.abort();
            publicUrl(url).then(ok => (ok ? request.continue() : request.abort())).catch(() => request.abort());
        });
        await tab.goto(address, { waitUntil: "networkidle2", timeout: 30000 });
        await tab.evaluate(async () => {
            for (let y = 0; y < Math.min(document.documentElement.scrollHeight, 12000); y += window.innerHeight) {
                window.scrollTo(0, y);
                await new Promise(r => setTimeout(r, 120));
            }
            window.scrollTo(0, 0);
        });
        await new Promise(r => setTimeout(r, 500));
        const pageHeight = await tab.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0));
        const height = Math.min(pageHeight, MAX_HEIGHT);
        const image = await tab.screenshot({ type: "webp", quality: 80, clip: { x: 0, y: 0, width: DEVICES[device].width, height } });
        return { image, pageHeight, shownHeight: height };
    } finally {
        await tab.close().catch(() => {});
    }
}

const fileFor = (siteKey, page, device) => {
    const hash = crypto.createHash("sha256").update(`${siteKey}|${page}`).digest("hex").slice(0, 24);
    return path.join(SHOT_DIR, siteKey.replace(/[^\w-]/g, ""), `${hash}-${device}.webp`);
};

async function takeShots(siteKey, page) {
    if (!await Account.exists({ deletion_requested_at: null, $or: [{ site_key: siteKey }, { "sites.key": siteKey }] })) return;
    let address = await addressFor(siteKey, page);
    if (address && process.env.PAGESHOT_LOCALHOST) address = address.replace(/^(https?:\/\/)localhost\b/, `$1${process.env.PAGESHOT_LOCALHOST}`);
    for (const device of Object.keys(DEVICES)) {
        const taken_at = new Date();
        try {
            if (!address || !(await publicUrl(address))) throw new Error("not a public address");
            let timer;
            const shot = await Promise.race([
                capture(address, device),
                new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timed out")), CAPTURE_TIMEOUT_MS); })
            ]).finally(() => clearTimeout(timer));
            const file = fileFor(siteKey, page, device);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, shot.image);
            await PageShot.updateOne({ site_key: siteKey, page, device }, {
                $set: { address, taken_at, file, page_height: shot.pageHeight, shown_height: shot.shownHeight, width: DEVICES[device].width, error: null },
                $setOnInsert: { viewed_at: taken_at }
            }, { upsert: true });
        } catch (err) {
            const error = String(err.message || err).slice(0, 200);
            logger.debug(`page shot failed  key=${siteKey}  page=${page}  device=${device}  ${error}`);
            if (error === "timed out") await closeBrowser();
            // A failed retake keeps the last good picture.
            await PageShot.updateOne({ site_key: siteKey, page, device }, { $set: { address, taken_at, last_error: error }, $setOnInsert: { error, viewed_at: taken_at } }, { upsert: true });
        }
    }
}

let queue = Promise.resolve();
const pending = new Set();
async function refreshShots(siteKey, page) {
    const key = `${siteKey}|${page}`;
    if (!page || pending.has(key) || pending.size >= MAX_QUEUE) return;
    const fresh = await PageShot.countDocuments({ site_key: siteKey, page, taken_at: { $gte: new Date(Date.now() - MAX_AGE_MS) } });
    if (fresh >= Object.keys(DEVICES).length) return;
    pending.add(key);
    queue = queue.then(() => takeShots(siteKey, page)).catch(err => logger.error("page shots failed:", err)).finally(() => {
        pending.delete(key);
        if (pending.size === 0) idleTimer = setTimeout(closeBrowser, IDLE_CLOSE_MS);
    });
}

async function shotInfo(siteKey, page) {
    const rows = await PageShot.find({ site_key: siteKey, page, error: null, file: { $ne: null } }, { _id: 0, device: 1, width: 1, page_height: 1, shown_height: 1, taken_at: 1 }).lean();
    return Object.fromEntries(rows.map(r => [r.device, r]));
}

async function shotFile(siteKey, page, device) {
    const row = await PageShot.findOneAndUpdate({ site_key: siteKey, page, device, error: null }, { $set: { viewed_at: new Date() } }, { projection: { file: 1 } }).lean();
    return row?.file && fs.existsSync(row.file) ? row.file : null;
}

async function removeShots(filter) {
    const rows = await PageShot.find(filter, { file: 1 }).lean();
    for (const row of rows) if (row.file) fs.rmSync(row.file, { force: true });
    await PageShot.deleteMany({ _id: { $in: rows.map(r => r._id) } });
    if (Object.keys(filter).length === 1 && typeof filter.site_key === "string" && /^tt_[\w-]+$/.test(filter.site_key)) {
        fs.rmSync(path.join(SHOT_DIR, filter.site_key), { recursive: true, force: true });
    }
    return rows.length;
}

const removeUnviewedShots = (now = Date.now()) => removeShots({ viewed_at: { $lt: new Date(now - UNVIEWED_DAYS * DAY_MS) } });

const shotsPending = siteKey => [...pending].some(key => key.startsWith(`${siteKey}|`));
module.exports = { refreshShots, shotInfo, shotFile, removeShots, removeUnviewedShots, publicUrl, privateAddress, shotsPending };
