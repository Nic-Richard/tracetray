// Visitor IDs without storing anything on the visitor's device: a hash of a daily random salt, the site
// key, and what the browser sends with every request anyway (IP address, user agent, preferred languages). The IP is never stored, and each day's salt is deleted
// once the next day starts, so yesterday's IDs can't be linked to today's or traced back to anyone.
const crypto = require("crypto");
const mongoose = require("mongoose");

const VisitorSalt = mongoose.models.VisitorSalt || mongoose.model("VisitorSalt", new mongoose.Schema({
    day:  { type: String, required: true, unique: true },
    salt: { type: String, required: true }
}), "visitor_salts");

let current = null;

// The salt lives in the database so a restart mid-day keeps the same IDs.
async function saltFor(day) {
    if (current?.day === day) return current.salt;
    const doc = await VisitorSalt.findOneAndUpdate(
        { day },
        { $setOnInsert: { day, salt: crypto.randomBytes(32).toString("hex") } },
        { upsert: true, new: true }
    ).lean();
    await VisitorSalt.deleteMany({ day: { $lt: day } });
    current = { day, salt: doc.salt };
    return doc.salt;
}

async function visitorIdFor({ siteKey, ip, userAgent, language, now = Date.now() }) {
    const salt = await saltFor(new Date(now).toISOString().slice(0, 10));
    return crypto.createHash("sha256").update(`${salt}|${siteKey}|${ip || ""}|${userAgent || ""}|${String(language || "").slice(0, 200)}`).digest("base64url").slice(0, 22);
}

module.exports = { visitorIdFor };
