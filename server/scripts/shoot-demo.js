// Takes the demo store's page pictures and layouts from the pages in demo-store/, the same way a customer's
// pages are taken, so the demo's attention picture and section numbers come from real pages.
// docker compose exec server node scripts/shoot-demo.js [site_key]
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });
const fs = require("fs");
const http = require("http");
const path = require("path");
const mongoose = require("mongoose");
const { MONGODB_URI } = require("../src/config");
const { Account, PageShot } = require("../src/db/models");
const { capture, closeBrowser, fileFor, DEVICES } = require("../src/lib/pageShots");

const STORE = path.join(__dirname, "demo-store");
const ORIGIN = "https://morrowpine.example";
const PAGES = ["/", "/collections/:collection", "/products/:product"];

const fileForPath = url => url === "/" ? "home.html" : url.startsWith("/collections/") ? "collection.html" : url.startsWith("/products/") ? "product.html" : path.basename(url);

(async () => {
    await mongoose.connect(MONGODB_URI);
    const requested = process.argv[2];
    const account = requested
        ? await Account.findOne({ $or: [{ site_key: requested }, { "sites.key": requested }] })
        : await Account.findOne().sort({ created_at: -1 });
    if (!account) throw new Error("no account yet: sign in to the local dashboard once, then run this again");
    const site = account.sites.find(s => s.key === requested) || account.sites[0];

    const server = http.createServer((req, res) => {
        const file = path.join(STORE, fileForPath(new URL(req.url, "http://x").pathname));
        if (!file.startsWith(STORE) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { "Content-Type": file.endsWith(".css") ? "text/css" : "text/html" });
        fs.createReadStream(file).pipe(res);
    }).listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const local = `http://127.0.0.1:${server.address().port}`;

    try {
        for (const pattern of PAGES) {
            const page = ORIGIN + pattern;
            for (const device of Object.keys(DEVICES)) {
                const shot = await capture(local + pattern.replace(/:\w+/, "sample"), device, { trusted: true });
                const out = fileFor(site.key, page, device);
                fs.mkdirSync(path.dirname(out), { recursive: true });
                fs.writeFileSync(out, shot.image);
                await PageShot.updateOne({ site_key: site.key, page, device }, {
                    $set: { address: page.replace(/:\w+/, "sample"), file: out, taken_at: new Date(), viewed_at: new Date(), width: DEVICES[device].width,
                        page_height: shot.pageHeight, shown_height: shot.shownHeight, layout: shot.layout, error: null, last_error: null }
                }, { upsert: true });
                console.log(`${pattern} ${device}: ${shot.pageHeight}px, ${shot.layout.sections.length} sections, ${shot.layout.elements.length} elements`);
            }
        }
    } finally {
        server.close();
        await closeBrowser();
        await mongoose.disconnect();
    }
})().catch(err => {
    console.error(err.message);
    process.exit(1);
});
