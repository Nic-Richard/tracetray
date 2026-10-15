require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const logger   = require("./src/lib/logger");
const express  = require("express");
const mongoose = require("mongoose");
const cors     = require("cors");
const path     = require("path");
const { clerkMiddleware } = require("@clerk/express");

const { MONGODB_URI, PORT } = require("./src/config");
const { startSessionCleanupJob } = require("./src/jobs/sessionCleanup");
const { startEventRetentionJob } = require("./src/jobs/eventRetention");
const { startDataHoldJob } = require("./src/jobs/dataHold");
const { startWeeklySummaryJob } = require("./src/jobs/weeklySummary");
const { startAutoAnalysisJob } = require("./src/jobs/autoAnalysis");

const app = express();
// nginx is the only proxy in front, so req.ip is the address it saw.
app.set("trust proxy", 1);
// uBlock blocks third-party responses from short .com domains that carry Express's weak ETag.
app.set("etag", false);

app.use((req, res, next) => {
    res.set({
        "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "strict-origin-when-cross-origin"
    });
    next();
});
app.use(cors());
app.use(clerkMiddleware());

// Stripe verifies the raw webhook body.
app.use("/webhook/stripe", express.raw({ type: "application/json" }));
app.use("/collect", express.json({ limit: "5mb", type: "text/plain" }));
app.use(express.json({ limit: "5mb" }));
// Express 5 leaves req.body undefined when a request has no body; routes expect an object.
app.use((req, res, next) => { if (req.body === undefined) req.body = {}; next(); });
// Same addresses as nginx: pages without .html, and the old .html ones redirect.
app.get(/^\/(pricing|privacy|terms|collects|sign-in|billing|tracetray)\.html$/, (req, res) => {
    const query = req.originalUrl.indexOf("?");
    const page = req.params[0] === "tracetray" ? "" : req.params[0];
    res.redirect(301, `/${page}${query === -1 ? "" : req.originalUrl.slice(query)}`);
});
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"], index: "tracetray.html" }));
app.get("/dashboard.html", (req, res) => {
    const query = req.originalUrl.indexOf("?");
    res.redirect(301, `/app/${query === -1 ? "" : req.originalUrl.slice(query)}`);
});
// The React dashboard routes on the client, so any /app address loads its page.
app.get(/^\/app(\/.*)?$/, (req, res) => res.sendFile(path.join(__dirname, "public", "app", "index.html")));
app.use("/client", express.static(path.join(__dirname, "..", "client")));

mongoose.connection.on("error", err => logger.error("MongoDB error:", err.message));

app.use(require("./src/routes/account"));
app.use(require("./src/routes/bugReports"));
app.use(require("./src/routes/billing"));
app.use(require("./src/routes/health"));
app.use(require("./src/routes/collect"));
app.use(require("./src/routes/stats"));
app.use(require("./src/routes/analysis"));
app.use(require("./src/routes/ask"));
app.use(require("./src/routes/pageGroups"));
app.use(require("./src/routes/email"));
app.use(require("./src/routes/compare"));
app.use(require("./src/routes/export"));
app.use(require("./src/routes/goals"));
app.use(require("./src/routes/paths"));

// Malformed or oversized bodies come from bots and broken clients; answer without logging a stack trace.
app.use((err, req, res, next) => {
    if (err.type === "entity.parse.failed" || err.type === "entity.too.large") return res.sendStatus(err.status || 400);
    next(err);
});

async function startServer() {
    try {
        await mongoose.connect(MONGODB_URI);
        logger.info("Connected to MongoDB");
        app.listen(PORT, "0.0.0.0", () => logger.info(`TraceTray server running on port ${PORT}`));
    } catch (err) {
        logger.error("MongoDB connection failed:", err.message);
        process.exit(1);
    }
}

startServer();
startSessionCleanupJob();
startEventRetentionJob();
require("./src/lib/goalHits").resumeBackfills().catch(err => logger.error("goal backfill resume error:", err));
startDataHoldJob();
startWeeklySummaryJob();
startAutoAnalysisJob();
