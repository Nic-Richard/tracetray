const express = require("express");
const router = express.Router();
const path = require("path");
const { spawn } = require("child_process");
const { getAuth } = require("@clerk/express");
const { requireAuth } = require("../middleware/auth");
const { Account, Session, AnalysisResult } = require("../db/models");
const { resolveSiteKey, getClientIP } = require("../lib/siteAccount");
const { getClickSummary } = require("../lib/clickSummary");
const { computeAttentionProfile } = require("../lib/attentionProfile");
const { buildInterpretationPrompt, callAI } = require("../lib/aiInterpretation");
const {
    analysisRunning,
    lastAICallByIP,
    AI_COOLDOWN_MS,
    PAGE_REFRESH_COOLDOWN_MS,
    ALL_REFRESH_COOLDOWN_MS,
    utcDayKey,
    createAnalysisPermit,
    consumeAnalysisPermit
} = require("../lib/analysisState");
const { TRACETRAY_MODE } = require("../config");
const logger = require("../lib/logger");

router.post("/api/analysis-permit", requireAuth(), async (req, res) => {
    try {
        const userId = getAuth(req).userId;
        const account = await Account.findOne({ clerk_user_id: userId });
        if (!account) return res.status(404).json({ error: "account not found" });

        const siteKey = resolveSiteKey(req, account);
        if (!siteKey) return res.status(403).json({ error: "website not available" });
        if (TRACETRAY_MODE === "production" && account.plan === "none") {
            return res.status(403).json({ error: "active subscription required" });
        }

        const site = account.sites.find(item => item.key === siteKey);
        if (!site) return res.status(404).json({ error: "website not found" });

        const scope = req.body.scope === "all" ? "all" : "page";
        const now = new Date();
        const nowMs = now.getTime();

        if (scope === "all") {
            const lastAll = site.last_all_refresh_at
                ? new Date(site.last_all_refresh_at).getTime()
                : 0;
            const remainingMs = ALL_REFRESH_COOLDOWN_MS - (nowMs - lastAll);

            if (remainingMs > 0) {
                return res.status(429).json({
                    error: "refresh all pages is available once per hour",
                    cooldown_remaining_ms: remainingMs
                });
            }

            const pageCount = Math.max(1, Math.min(100, Number(req.body.page_count) || 1));
            site.last_all_refresh_at = now;
            await account.save();

            return res.json({
                permit_token: createAnalysisPermit(userId, siteKey, "all", pageCount),
                scope,
                remaining_free_today: Math.max(0, 3 - (site.page_refresh_count || 0))
            });
        }

        const today = utcDayKey(now);
        if (site.refresh_day !== today) {
            site.refresh_day = today;
            site.page_refresh_count = 0;
            site.last_page_refresh_at = null;
        }

        const usedToday = site.page_refresh_count || 0;
        if (usedToday >= 3) {
            const lastPage = site.last_page_refresh_at
                ? new Date(site.last_page_refresh_at).getTime()
                : 0;
            const remainingMs = PAGE_REFRESH_COOLDOWN_MS - (nowMs - lastPage);

            if (remainingMs > 0) {
                return res.status(429).json({
                    error: "next page refresh is not ready yet",
                    cooldown_remaining_ms: remainingMs,
                    remaining_free_today: 0
                });
            }
        }

        site.page_refresh_count = usedToday + 1;
        site.last_page_refresh_at = now;
        await account.save();

        res.json({
            permit_token: createAnalysisPermit(userId, siteKey, "page", 1),
            scope,
            remaining_free_today: Math.max(0, 3 - site.page_refresh_count)
        });
    } catch (err) {
        logger.error("analysis permit error:", err);
        res.status(500).json({ error: "could not start refresh" });
    }
});

router.post("/api/run-analysis", requireAuth(), async (req, res) => {
    const account = await Account.findOne({ clerk_user_id: getAuth(req).userId }).lean();
    if (!account) return res.status(404).json({ error: "account not found" });

    const siteKey = resolveSiteKey(req, account);
    if (!siteKey) return res.status(403).json({ error: "website not available" });

    if (TRACETRAY_MODE === "production" && account.plan === "none") return res.status(403).json({ error: "active subscription required" });

    const permitToken = String(req.body?.permit_token || "");
    if (!consumeAnalysisPermit(permitToken, getAuth(req).userId, siteKey)) {
        return res.status(429).json({ error: "refresh permission expired; try again" });
    }

    const pageFilter = req.body?.page || null;
    if (analysisRunning[siteKey]) return res.status(409).json({ error: "analysis already running" });

    analysisRunning[siteKey] = true;
    logger.debug(`starting analysis  key=${siteKey}`);

    const env = { ...process.env, TRACETRAY_SITE_KEY: siteKey, TRACETRAY_PAGE_FILTER: pageFilter || "" };

    const extractScript = path.join(__dirname, "..", "..", "..", "analysis", "extractFeatures.js");
    const extractProc   = spawn("node", [extractScript], { cwd: path.join(__dirname, "..", "..", ".."), env });

    let extractLog = "";
    extractProc.stdout.on("data", d => { extractLog += d; });
    extractProc.stderr.on("data", d => { extractLog += d; });

    function runPythonAnalysis(device) {
        return new Promise((resolve) => {
            const pyScript = path.join(__dirname, "..", "..", "..", "ml", "analyze.py");
            const pyProc   = spawn("python3", [pyScript, "--json-summary", "--device", device], {
                cwd: path.join(__dirname, "..", "..", "..", "ml"),
                env
            });

            let stdout = "", stderr = "";
            pyProc.stdout.on("data", d => { stdout += d; });
            pyProc.stderr.on("data", d => { stderr += d; });

            pyProc.on("close", (code) => {
                if (code !== 0) {
                    logger.error(`python (${device}) failed:`, stderr);
                    return resolve(null);
                }
                const marker     = "TRACETRAY_RESULT:";
                const resultLine = stdout.split("\n").find(l => l.startsWith(marker));
                if (!resultLine) return resolve(null);

                try { resolve(JSON.parse(resultLine.slice(marker.length).trim())); }
                catch (e) { resolve(null); }
            });
        });
    }

    extractProc.on("close", async (extractCode) => {
        if (extractCode !== 0) {
            logger.error(`extraction failed (exit ${extractCode}):`, extractLog);
            analysisRunning[siteKey] = false;
            return res.status(500).json({ error: "extraction failed", detail: extractLog.slice(0, 500) });
        }
        logger.debug(`extraction done (exit ${extractCode})`);

        const clusterResult = await runPythonAnalysis("desktop");

        if (!clusterResult) {
            analysisRunning[siteKey] = false;
            return res.status(500).json({ error: "clustering failed" });
        }

// Mobile analysis is optional when no mobile traffic is available.
        const mobileResult = await runPythonAnalysis("mobile");

        clusterResult.site_key = siteKey;
        clusterResult.page     = pageFilter || "all";
        clusterResult.ran_at   = new Date();

// Mobile results are stored without a separate model interpretation.
        if (mobileResult) {
            clusterResult.mobile = {
                session_count:    mobileResult.session_count,
                k:                mobileResult.k,
                silhouette_score: mobileResult.silhouette_score,
                clusters:         mobileResult.clusters,
                kruskal_wallis:   mobileResult.kruskal_wallis,
                k_rationale:      mobileResult.k_rationale,
                failure:          mobileResult.failure || null
            };
        }

        const clientIP        = getClientIP(req);
        const ipKey           = `${clientIP}::${siteKey}::${pageFilter || "all"}`;
        const lastAICall      = lastAICallByIP[ipKey] || 0;
        const msSinceLast     = Date.now() - lastAICall;
        const aiAllowed       = msSinceLast >= AI_COOLDOWN_MS;

// Save click history even when model interpretation is rate-limited.
        const clickSummary = await getClickSummary(siteKey, pageFilter, 15);
        clusterResult.click_summary = clickSummary;

        if (!aiAllowed) {
            logger.debug(`interpretation rate-limited  ip=${clientIP}  wait=${Math.ceil((AI_COOLDOWN_MS - msSinceLast)/1000)}s`);
            const prev = await AnalysisResult.findOne({ site_key: siteKey, page: pageFilter || "all", "ai_interpretation": { $ne: null } }).sort({ ran_at: -1 }).lean();
            if (prev?.ai_interpretation) clusterResult.ai_interpretation = prev.ai_interpretation;
        } else {
            try {
                let pageUrl = pageFilter;
                if (!pageUrl) {
                    const recentSess = await Session.findOne({ site_key: siteKey, end_time: { $ne: null } }).sort({ start_time: -1 }).lean();
                    pageUrl = recentSess?.page || null;
                }
                const attentionResult = await computeAttentionProfile(siteKey, pageFilter || null);
                const prompt          = buildInterpretationPrompt({
                    clusters:        clusterResult.clusters || [],
                    kwResults:       clusterResult.kruskal_wallis || [],
                    clickSummary,
                    kRationale:      clusterResult.k_rationale || {},
                    sessionCount:    clusterResult.session_count || 0,
                    pageUrl,
                    firstImpression: attentionResult.first_impression,
                    mobileResult:    clusterResult.mobile || null
                });
                const interpretation = await callAI(prompt);
                if (interpretation) {
                    clusterResult.ai_interpretation = interpretation;
                    lastAICallByIP[ipKey] = Date.now();
                    logger.debug("interpretation complete");
                }
            } catch (aiErr) {
                logger.error("interpretation failed:", aiErr.message);
            }
        }

        analysisRunning[siteKey] = false;
        await AnalysisResult.create(clusterResult);
        logger.info(`analysis saved  key=${siteKey}  k=${clusterResult.k}  n=${clusterResult.session_count}  mobile_n=${mobileResult?.session_count ?? 0}`);

        res.json({
            ok:                       true,
            result:                   clusterResult,
            ai_used:                  aiAllowed && !!clusterResult.ai_interpretation,
            ai_cooldown_remaining_ms: aiAllowed ? 0 : Math.max(0, AI_COOLDOWN_MS - msSinceLast),
            next_ai_allowed_in_ms:    aiAllowed ? AI_COOLDOWN_MS : Math.max(0, AI_COOLDOWN_MS - msSinceLast)
        });
    });
});

module.exports = router;
