const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { Account, Session, AnalysisResult, BugReport, PageDay } = require("../db/models");
const { analysisRunning } = require("./analysisState");
const { planLimits } = require("./plans");
const { removeShots } = require("./pageShots");

function generateSiteKey() {
    return "tt_" + crypto.randomBytes(12).toString("base64url");
}

function getSiteLimit(account) {
    const limits = planLimits(account.plan);
    if (!limits) return 1;
    return limits.sites ?? 100;
}

function getAccountSites(account) {
    if (Array.isArray(account.sites) && account.sites.length) return account.sites;
    if (!account.site_key) return [];
    return [{
        key: account.site_key,
        name: account.site_url || "My website",
        url: account.site_url || null,
        domain: null,
        created_at: account.created_at || new Date()
    }];
}

async function ensureAccountSites(account) {
    if (Array.isArray(account.sites) && account.sites.length) return account.sites;
    account.sites = getAccountSites(account);
    await account.save();
    return account.sites;
}

function resolveSiteKey(req, account) {
    const sites = getAccountSites(account);
    const requested = String(req.query.site_key || req.body?.site_key || "").trim();
    const selected = requested || sites[0]?.key || account.site_key;
    return sites.some(site => site.key === selected) ? selected : null;
}

async function deleteSiteData(siteKey) {
    const [sessions, analyses, reports] = await Promise.all([
        Session.deleteMany({ site_key: siteKey }),
        AnalysisResult.deleteMany({ site_key: siteKey }),
        BugReport.deleteMany({ site_key: siteKey }),
        PageDay.deleteMany({ site_key: siteKey })
    ]);

    delete analysisRunning[siteKey];
    await removeShots({ site_key: siteKey });

    const featureDir = path.join(__dirname, "..", "..", "..", "data", "features");
    for (const device of ["desktop", "mobile", "meta"]) {
        const file = path.join(featureDir, `dataset_${siteKey}_${device}.json`);
        if (fs.existsSync(file)) fs.unlinkSync(file);
    }

    return {
        sessions: sessions.deletedCount,
        analyses: analyses.deletedCount,
        reports: reports.deletedCount
    };
}

module.exports = {
    generateSiteKey,
    getSiteLimit,
    getAccountSites,
    ensureAccountSites,
    resolveSiteKey,
    deleteSiteData
};
