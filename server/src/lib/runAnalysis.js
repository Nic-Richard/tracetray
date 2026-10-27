// One analysis run for a site (or one page of it): extract features, cluster desktop and mobile,
// describe the groups and save the result. Used by the Refresh button and the weekly runs.
const path = require("path");
const { runProcess } = require("./runProcess");
const { Account, Session, AnalysisResult } = require("../db/models");
const { mainGoalFor } = require("./goalHits");
const { getClickSummary } = require("./clickSummary");
const { computeAttentionProfile } = require("./attentionProfile");
const { interpretClusters } = require("./interpretClusters");
const { trackGroups } = require("./groupTracking");
const { goalPosition } = require("./goalPosition");
const { analysisRunning } = require("./analysisState");
const logger = require("./logger");

const ROOT = path.join(__dirname, "..", "..", "..");

async function runPythonAnalysis(device, env) {
    const { stdout } = await runProcess(process.env.TRACETRAY_PYTHON || "python3", [path.join(ROOT, "ml", "analyze.py"), "--json-summary", "--device", device], {
        cwd: path.join(ROOT, "ml"), env
    });
    const marker = "TRACETRAY_RESULT:";
    const resultLine = stdout.split("\n").find(line => line.startsWith(marker));
    if (!resultLine) throw new Error(`python (${device}) returned no result`);
    return JSON.parse(resultLine.slice(marker.length).trim());
}

async function runAnalysis(siteKey, pageFilter = null) {
    if (analysisRunning[siteKey]) {
        const err = new Error("analysis already running");
        err.code = "BUSY";
        throw err;
    }
    analysisRunning[siteKey] = true;
    logger.debug(`starting analysis  key=${siteKey}`);
    try {
        if (!await Account.exists({ deletion_requested_at: null, $or: [{ site_key: siteKey }, { "sites.key": siteKey }] })) {
            throw new Error("website is unavailable for analysis");
        }
        const main = pageFilter ? await mainGoalFor(siteKey, pageFilter).catch(err => { logger.error("main goal lookup failed:", err); return null; }) : null;
        const env = { ...process.env, TRACETRAY_SITE_KEY: siteKey, TRACETRAY_PAGE_FILTER: pageFilter || "",
            TRACETRAY_GOAL: main ? JSON.stringify({ id: main.id, type: main.type, match: main.match }) : "" };
        await runProcess(process.execPath, [path.join(ROOT, "analysis", "extractFeatures.js")], { cwd: ROOT, env });
        logger.debug("extraction done");

        const clusterResult = await runPythonAnalysis("desktop", env);

        // Mobile analysis is optional when no mobile traffic is available.
        let mobileResult = null;
        try {
            mobileResult = await runPythonAnalysis("mobile", env);
        } catch (err) {
            logger.error("mobile analysis failed:", err);
        }

        clusterResult.site_key = siteKey;
        clusterResult.page     = pageFilter || "all";
        clusterResult.ran_at   = new Date();

        // Mobile results are stored without a separate model interpretation.
        if (mobileResult) {
            const { device, ...mobile } = mobileResult;
            clusterResult.mobile = { ...mobile, failure: mobile.failure || null };
        }

        clusterResult.click_summary = await getClickSummary(siteKey, pageFilter, 15);

        try {
            const previous = await AnalysisResult.findOne({ site_key: siteKey, page: clusterResult.page }).sort({ ran_at: -1 }).lean();
            trackGroups(previous, clusterResult);
        } catch (err) {
            logger.error("group tracking failed:", err);
        }

        try {
            let pageUrl = pageFilter;
            if (!pageUrl) {
                const recentSess = await Session.findOne({ site_key: siteKey, end_time: { $ne: null } }).sort({ start_time: -1 }).lean();
                pageUrl = recentSess?.page || null;
            }
            const attentionResult = await computeAttentionProfile(siteKey, pageFilter || null);
            const goal = main && { id: main.id, name: main.name, type: main.type, match: main.match, position: await goalPosition(siteKey, pageFilter, main) };
            if (goal) clusterResult.goal = goal;
            clusterResult.interpretation = interpretClusters({
                desktop:         clusterResult,
                mobile:          clusterResult.mobile || null,
                pageUrl,
                firstImpression: attentionResult.first_impression,
                goal
            });
        } catch (err) {
            logger.error("interpretation failed:", err);
        }

        await AnalysisResult.create(clusterResult);
        logger.info(`analysis saved  key=${siteKey}  k=${clusterResult.k}  n=${clusterResult.session_count}  mobile_n=${mobileResult?.session_count ?? 0}`);
        return clusterResult;
    } finally {
        analysisRunning[siteKey] = false;
    }
}

module.exports = { runAnalysis };
