require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const logger   = require("./src/lib/logger");
const express  = require("express");
const mongoose = require("mongoose");
const cors     = require("cors");
const path     = require("path");
const { clerkMiddleware } = require("@clerk/express");

const { MONGODB_URI, PORT } = require("./src/config");
const { startSessionCleanupJob } = require("./src/jobs/sessionCleanup");

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
app.use(express.static(path.join(__dirname, "public")));
app.use("/client", express.static(path.join(__dirname, "..", "client")));

mongoose.connection.on("error", err => logger.error("MongoDB error:", err.message));

app.use(require("./src/routes/account"));
app.use(require("./src/routes/bugReports"));
app.use(require("./src/routes/billing"));
app.use(require("./src/routes/health"));
app.use(require("./src/routes/collect"));
app.use(require("./src/routes/stats"));
app.use(require("./src/routes/analysis"));

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
