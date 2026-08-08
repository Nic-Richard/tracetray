const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { Account, Session, AnalysisResult, BugReport } = require("../db/models");
const { TRACETRAY_MODE, MAX_SITES_PER_ACCOUNT } = require("../config");
const { analysisRunning } = require("./analysisState");

function generateSiteKey() {
    return "tt_" + crypto.randomBytes(12).toString("base64url");
}

function getSiteLimit(account) {
    if (TRACETRAY_MODE === "beta") return MAX_SITES_PER_ACCOUNT;
    return account.plan === "pro" ? MAX_SITES_PER_ACCOUNT : 1;
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

function getClientIP(req) {
    return (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown")
        .split(",")[0].trim();
}

async function deleteSiteData(siteKey) {
    const [sessions, analyses, reports] = await Promise.all([
        Session.deleteMany({ site_key: siteKey }),
        AnalysisResult.deleteMany({ site_key: siteKey }),
        BugReport.deleteMany({ site_key: siteKey })
    ]);

    delete analysisRunning[siteKey];

    const featureDir = path.join(__dirname, "..", "..", "..", "data", "features");
    for (const device of ["desktop", "mobile"]) {
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
    getClientIP,
    deleteSiteData
};
