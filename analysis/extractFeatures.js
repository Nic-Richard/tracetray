// Builds separate desktop and mobile feature datasets from stored sessions.

const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

const basicFeatures = require("./featureModules/basicFeatures");
const movementFeatures = require("./featureModules/movementFeatures");
const spatialFeatures = require("./featureModules/spatialFeatures");
const mobileFeatures = require("./featureModules/mobileFeatures");
const scrollFeatures = require("./featureModules/scrollFeatures");

const SessionSchema = new mongoose.Schema({}, { strict: false });
const Session = mongoose.model("Session", SessionSchema, "sessions");

const MAX_SESSIONS_PER_DEVICE = 3000;

// The links and buttons a visit clicked or tapped, once each, so each group's most clicked targets can be named.
function clickTargets(session) {
    const seen = new Map();
    for (const e of session.events || []) {
        if ((e.type !== "click" && e.type !== "tap") || !e.target || typeof e.target !== "object") continue;
        const target = { text: e.target.text || null, href: e.target.href || null, id: e.target.id || null };
        if (!target.text && !target.href && !target.id) continue;
        seen.set(JSON.stringify(target), target);
    }
    return [...seen.values()];
}

async function run() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/sessionDB");
        const siteKeyFilter = process.env.TRACETRAY_SITE_KEY
            ? { site_key: process.env.TRACETRAY_SITE_KEY }
            : {};
        const pageFilter = process.env.TRACETRAY_PAGE_FILTER
            ? { page: process.env.TRACETRAY_PAGE_FILTER }
            : {};

        // Mobile sessions use touch and scroll events instead of cursor movement. Visits without full detail
        // (trimmed, left out of the sample, or over the plan's allowance) have nothing to measure.
        const interacted = [
            { "summary.mouse_moves": { $gt: 0 } },
            { "summary.taps": { $gt: 0 } },
            { "summary.scrolls": { $gt: 0 } }
        ];
        const visitFilter = { ...siteKeyFilter, ...pageFilter, end_time: { $ne: null }, detailed: { $ne: false } };
        const filter = { ...visitFilter, "events.0": { $exists: true }, $or: interacted };
        // The most recent visits are plenty for clustering and keep memory flat however busy a site gets.
        const recent = device => Session.find({ ...filter, ...device }).sort({ start_time: -1 }).limit(MAX_SESSIONS_PER_DEVICE).lean();
        const [desktopSessions, mobileSessions] = await Promise.all([
            recent({ device_type: { $ne: "mobile" } }),
            recent({ device_type: "mobile" })
        ]);

        // goal_hits and click_targets aren't features; they ride along so each group's goal rate and most
        // clicked targets can be counted.
        const desktopDataset = desktopSessions.map(session => ({
            session_id: session.session_id,
            goal_hits: session.goal_hits || [],
            click_targets: clickTargets(session),
            ...basicFeatures(session),
            ...movementFeatures(session),
            ...spatialFeatures(session),
            ...scrollFeatures(session)
        }));

        const mobileDataset = mobileSessions.map(session => ({
            session_id: session.session_id,
            goal_hits: session.goal_hits || [],
            click_targets: clickTargets(session),
            duration_ms: session.end_time ? session.end_time - session.start_time : 0,
            active_ms: basicFeatures.activeMs(session),
            total_events: (session.events || []).length,
            ...mobileFeatures(session),
            ...scrollFeatures(session)
        }));

        // Visits that never moved, scrolled or tapped can't be grouped, but they're counted (with the goals they
        // reached) over the same stretch of time as the grouped ones, so the groups can be read against every visit.
        const inactiveOf = async (sessions, device) => {
            if (sessions.length === 0) return { visits: 0, inactive: 0, inactive_goal_hits: {} };
            const since = sessions[sessions.length - 1].start_time;
            const rows = await Session.aggregate([
                { $match: { ...visitFilter, ...device, start_time: { $gte: since }, $nor: interacted } },
                { $project: { hits: { $setUnion: [{ $ifNull: ["$goal_hits", []] }, []] } } },
                { $facet: {
                    count: [{ $count: "n" }],
                    hits: [{ $unwind: "$hits" }, { $group: { _id: "$hits", n: { $sum: 1 } } }]
                } }
            ]);
            const inactive = rows[0]?.count[0]?.n || 0;
            return {
                visits: sessions.length + inactive,
                inactive,
                inactive_goal_hits: Object.fromEntries((rows[0]?.hits || []).map(h => [h._id, h.n]))
            };
        };
        const meta = {
            desktop: await inactiveOf(desktopSessions, { device_type: { $ne: "mobile" } }),
            mobile: await inactiveOf(mobileSessions, { device_type: "mobile" })
        };

        // Desktop and mobile datasets are analyzed separately.
        const datasetDir = path.join(__dirname, "..", "data", "features");
        fs.mkdirSync(datasetDir, { recursive: true });
        const siteKey     = process.env.TRACETRAY_SITE_KEY || "unknown";
        const desktopFile = path.join(datasetDir, `dataset_${siteKey}_desktop.json`);
        const mobileFile  = path.join(datasetDir, `dataset_${siteKey}_mobile.json`);

        // Remove stale datasets for this site only.
        const keepFiles = [`dataset_${siteKey}_desktop.json`, `dataset_${siteKey}_mobile.json`, `dataset_${siteKey}_meta.json`];
        const sitePrefix = `dataset_${siteKey}_`;
        const oldFiles  = fs.readdirSync(datasetDir).filter(f =>
            f.startsWith(sitePrefix) && f.endsWith(".json") && !keepFiles.includes(f)
        );
        oldFiles.forEach(f => {
            try { fs.unlinkSync(path.join(datasetDir, f)); } catch(e) {}
        });

        fs.writeFileSync(desktopFile, JSON.stringify(desktopDataset, null, 2));
        fs.writeFileSync(mobileFile, JSON.stringify(mobileDataset, null, 2));
        fs.writeFileSync(path.join(datasetDir, `dataset_${siteKey}_meta.json`), JSON.stringify(meta));

        console.log(`done. desktop: ${desktopDataset.length} sessions -> ${desktopFile}`);
        console.log(`done. mobile:  ${mobileDataset.length} sessions -> ${mobileFile}`);

    } catch (err) {
        console.error("extraction failed:", err);
        process.exitCode = 1;
    } finally {
        try {
            await mongoose.connection.close();
        } catch (err) {
            console.error("database cleanup failed:", err);
            process.exitCode = 1;
        }
    }
}

run();
