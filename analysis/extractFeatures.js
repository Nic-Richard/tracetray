// Builds separate desktop and mobile feature datasets from stored sessions.

const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

const basicFeatures = require("./featureModules/basicFeatures");
const movementFeatures = require("./featureModules/movementFeatures");
const spatialFeatures = require("./featureModules/spatialFeatures");
const mobileFeatures = require("./featureModules/mobileFeatures");
const scrollFeatures = require("./featureModules/scrollFeatures");
const { clickMatches, formMatches } = require("../server/src/lib/goals");

const SessionSchema = new mongoose.Schema({}, { strict: false });
const Session = mongoose.model("Session", SessionSchema, "sessions");

const MAX_SESSIONS_PER_DEVICE = 20000;
const WINDOW_DAYS = 90;

const WINDOWS_S = [5, 10, 20, 40, 80, 160];

// For a click or form goal: the visit's measures over each of its first seconds that end before the goal (or before
// the visit ends). The goal model compares every visit over one of these, so it never sees the goal click itself.
function goalWindows(session, goal, measure) {
    if (!goal || (goal.type !== "click" && goal.type !== "form")) return {};
    const events = session.events || [];
    const reached = (session.goal_hits || []).includes(goal.id);
    const at = reached ? events.findIndex(e => clickMatches(goal, e) || formMatches(goal, e)) : -1;
    const stop = at >= 0 ? events[at].timestamp : session.end_time;
    const windows = {};
    for (const seconds of WINDOWS_S) {
        const end = session.start_time + seconds * 1000;
        if (!(end < stop)) break;
        windows[seconds] = measure({ ...session, events: events.filter(e => e.timestamp < end), end_time: end });
    }
    return { goal_after_ms: at >= 0 ? stop - session.start_time : null, windows };
}

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
        const goal = process.env.TRACETRAY_GOAL ? JSON.parse(process.env.TRACETRAY_GOAL) : null;

        // Mobile sessions use touch and scroll events instead of cursor movement. Visits without full detail
        // (trimmed, left out of the sample, or over the plan's allowance) have nothing to measure.
        const interacted = [
            { "summary.mouse_moves": { $gt: 0 } },
            { "summary.taps": { $gt: 0 } },
            { "summary.scrolls": { $gt: 0 } }
        ];
        const until = Date.now();
        const since = until - WINDOW_DAYS * 24 * 60 * 60 * 1000;
        const visitFilter = { ...siteKeyFilter, ...pageFilter, end_time: { $ne: null }, detailed: { $ne: false }, start_time: { $gte: since, $lte: until } };
        const filter = { ...visitFilter, "events.0": { $exists: true }, $or: interacted };
        // Visits are read one at a time and only their feature rows kept, so memory stays flat at the cap.
        const recent = async (device, toRow) => {
            const rows = [];
            let oldest = null;
            for await (const session of Session.find({ ...filter, ...device }).sort({ start_time: -1 }).limit(MAX_SESSIONS_PER_DEVICE).lean().cursor()) {
                rows.push(toRow(session));
                oldest = session.start_time;
            }
            return { rows, oldest };
        };

        // goal_hits and click_targets aren't features; they ride along so each group's goal rate and most
        // clicked targets can be counted.
        const desktopFeatures = session => ({
            ...basicFeatures(session),
            ...movementFeatures(session),
            ...spatialFeatures(session),
            ...scrollFeatures(session)
        });
        const desktop = await recent({ device_type: { $ne: "mobile" } }, session => ({
            session_id: session.session_id,
            start_time: session.start_time,
            goal_hits: session.goal_hits || [],
            click_targets: clickTargets(session),
            ...desktopFeatures(session),
            ...goalWindows(session, goal, desktopFeatures)
        }));

        const mobileMeasures = session => ({
            duration_ms: session.end_time ? session.end_time - session.start_time : 0,
            active_ms: basicFeatures.activeMs(session),
            total_events: (session.events || []).length,
            ...mobileFeatures(session),
            ...scrollFeatures(session)
        });
        const mobile = await recent({ device_type: "mobile" }, session => ({
            session_id: session.session_id,
            start_time: session.start_time,
            goal_hits: session.goal_hits || [],
            click_targets: clickTargets(session),
            ...mobileMeasures(session),
            ...goalWindows(session, goal, mobileMeasures)
        }));
        const desktopDataset = desktop.rows, mobileDataset = mobile.rows;

        // Visits that never moved, scrolled or tapped can't be grouped, but they're counted (with the goals they
        // reached) over the same stretch of time as the grouped ones, so the groups can be read against every visit.
        const inactiveOf = async ({ rows: sessions, oldest }, device) => {
            const from = oldest ?? since;
            const rows = await Session.aggregate([
                { $match: { ...siteKeyFilter, ...pageFilter, ...device, end_time: { $ne: null }, start_time: { $gte: from, $lte: until } } },
                { $facet: {
                    count: [{ $match: { detailed: { $ne: false }, $nor: interacted } }, { $count: "n" }],
                    hits: [{ $match: { detailed: { $ne: false }, $nor: interacted } },
                        { $project: { hits: { $setUnion: [{ $ifNull: ["$goal_hits", []] }, []] } } },
                        { $unwind: "$hits" }, { $group: { _id: "$hits", n: { $sum: 1 } } }],
                    without_detail: [{ $match: { detailed: false } }, { $count: "n" }],
                    without_events: [{ $match: { detailed: { $ne: false }, $or: interacted, "events.0": { $exists: false } } }, { $count: "n" }]
                } }
            ]);
            const inactive = rows[0]?.count[0]?.n || 0;
            return {
                visits: sessions.length + inactive,
                inactive,
                inactive_goal_hits: Object.fromEntries((rows[0]?.hits || []).map(h => [h._id, h.n])),
                scope: {
                    from: new Date(from).toISOString(), to: new Date(until).toISOString(),
                    window_days: WINDOW_DAYS, limit: MAX_SESSIONS_PER_DEVICE,
                    at_limit: sessions.length === MAX_SESSIONS_PER_DEVICE,
                    excluded_detail: rows[0]?.without_detail?.[0]?.n || 0,
                    excluded_events: rows[0]?.without_events?.[0]?.n || 0
                }
            };
        };
        const meta = {
            desktop: await inactiveOf(desktop, { device_type: { $ne: "mobile" } }),
            mobile: await inactiveOf(mobile, { device_type: "mobile" })
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
