// Re-files stored sessions under each site's page groups and rebuilds the daily page counts.
// Run once after deploying page groups, or after restoring a backup: node scripts/rebuild-page-days.js
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });
const mongoose = require("mongoose");
const { MONGODB_URI } = require("../src/config");
const { Account } = require("../src/db/models");
const { regroupSite } = require("../src/lib/pageDays");

(async () => {
    await mongoose.connect(MONGODB_URI);
    const accounts = await Account.find({}, { sites: 1, site_key: 1 }).lean();
    for (const account of accounts) {
        const sites = account.sites?.length ? account.sites : [{ key: account.site_key }];
        for (const site of sites) {
            const moved = await regroupSite(site.key, site.page_groups || []);
            console.log(`${site.key}: ${moved} sessions updated`);
        }
    }
    await mongoose.disconnect();
})().catch(err => {
    console.error(err);
    process.exit(1);
});
