// Builds separate desktop and mobile feature datasets from stored sessions.

const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

const basicFeatures = require("./featureModules/basicFeatures");
const movementFeatures = require("./featureModules/movementFeatures");
const spatialFeatures = require("./featureModules/spatialFeatures");
const mobileFeatures = require("./featureModules/mobileFeatures");

mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/sessionDB");

const SessionSchema = new mongoose.Schema({}, { strict: false });
const Session = mongoose.model("Session", SessionSchema, "sessions");

async function run() {
    try {

        const siteKeyFilter = process.env.TRACETRAY_SITE_KEY
            ? { site_key: process.env.TRACETRAY_SITE_KEY }
            : {};
        const pageFilter = process.env.TRACETRAY_PAGE_FILTER
            ? { page: process.env.TRACETRAY_PAGE_FILTER }
            : {};

        // Mobile sessions use touch and scroll events instead of cursor movement.
        const allSessions = await Session.find({
            ...siteKeyFilter,
            ...pageFilter,
            end_time: { $ne: null },
            $or: [
                { "summary.mouse_moves": { $gt: 0 } },
                { "summary.taps": { $gt: 0 } },
                { "summary.scrolls": { $gt: 0 } }
            ]
        });

        const desktopSessions = allSessions.filter(s => (s.device_type || "desktop") === "desktop");
        const mobileSessions  = allSessions.filter(s => s.device_type === "mobile");

        const desktopDataset = desktopSessions.map(session => ({
            session_id: session.session_id,
            ...basicFeatures(session),
            ...movementFeatures(session),
            ...spatialFeatures(session)
        }));

        const mobileDataset = mobileSessions.map(session => ({
            session_id: session.session_id,
            duration_ms: session.end_time ? session.end_time - session.start_time : 0,
            total_events: (session.events || []).length,
            ...mobileFeatures(session)
        }));

        // Desktop and mobile datasets are analyzed separately.
        const datasetDir = path.join(__dirname, "..", "data", "features");
        const siteKey     = process.env.TRACETRAY_SITE_KEY || "unknown";
        const desktopFile = path.join(datasetDir, `dataset_${siteKey}_desktop.json`);
        const mobileFile  = path.join(datasetDir, `dataset_${siteKey}_mobile.json`);

        // Remove stale datasets for this site only.
        const keepFiles = [`dataset_${siteKey}_desktop.json`, `dataset_${siteKey}_mobile.json`];
        const sitePrefix = `dataset_${siteKey}_`;
        const oldFiles  = fs.readdirSync(datasetDir).filter(f =>
            f.startsWith(sitePrefix) && f.endsWith(".json") && !keepFiles.includes(f)
        );
        oldFiles.forEach(f => {
            try { fs.unlinkSync(path.join(datasetDir, f)); } catch(e) {}
        });

        fs.writeFileSync(desktopFile, JSON.stringify(desktopDataset, null, 2));
        fs.writeFileSync(mobileFile, JSON.stringify(mobileDataset, null, 2));

        console.log(`done. desktop: ${desktopDataset.length} sessions -> ${desktopFile}`);
        console.log(`done. mobile:  ${mobileDataset.length} sessions -> ${mobileFile}`);

    } catch (err) {
        console.error("extraction failed:", err);
    } finally {
        mongoose.connection.close();
        process.exit();
    }
}

run();
