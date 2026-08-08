const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { TRACETRAY_MODE } = require("../config");

router.get("/api/health", (req, res) => {
    const databaseReady = mongoose.connection.readyState === 1;
    res.status(databaseReady ? 200 : 503).json({ ok: databaseReady, database: databaseReady ? "connected" : "disconnected" });
});

router.get("/api/config", (req, res) => {
    res.json({
        clerk_publishable_key: process.env.CLERK_PUBLISHABLE_KEY,
        site_key: process.env.TRACETRAY_OWN_SITE_KEY || null,
        mode: TRACETRAY_MODE
    });
});

module.exports = router;
