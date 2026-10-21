const mongoose = require("mongoose");

const Account = mongoose.model("Account", new mongoose.Schema({
    site_key:          { type: String, required: true, unique: true, index: true },
    clerk_user_id:     { type: String, unique: true, sparse: true, index: true },
    email:             { type: String, required: true },
    site_url:          String,
    sites: [{
        key:        { type: String, required: true },
        name:       { type: String, required: true },
        url:        String,
        domain:     String,
        refresh_day: String,
        page_refresh_count: { type: Number, default: 0 },
        last_page_refresh_at: Date,
        last_all_refresh_at: Date,
        page_groups: [String],
        page_changes: [{ id: String, page: String, day: String, note: String, created_at: Date }],
        goals: [{ _id: false, id: String, name: String, type: { type: String }, match: Object, pages: [String], target: Number, backfill: String, backfill_at: Date, created_at: Date }],
        main_goals: [{ _id: false, page: String, goal: String }],
        paths: [{ _id: false, id: String, name: String, steps: [String], created_at: Date }],
        regrouping_at: Date,
        created_at: Date
    }],
    stripe_customer_id: String,
    plan:              { type: String, enum: ["starter", "pro", "ultra", "enterprise", "none"], default: "none" },
    created_at:        Date
}, { strict: false }), "accounts");

const sessionSchema = new mongoose.Schema({
    site_key:    { type: String, index: true },
    visitor_id:  { type: String, index: true },
    device_type: { type: String, enum: ["desktop", "mobile"], default: "desktop", index: true },
    referrer:    String
}, { strict: false });
sessionSchema.index({ site_key: 1, start_time: -1 });
sessionSchema.index({ site_key: 1, session_id: 1 }, { unique: true });
sessionSchema.index({ site_key: 1, visitor_id: 1, start_time: 1 });
sessionSchema.index({ site_key: 1, goal_hits: 1 });
const Session = mongoose.model("Session", sessionSchema, "sessions");

const AnalysisResult = mongoose.model("AnalysisResult", new mongoose.Schema({
    site_key:            { type: String, index: true },
    page:                { type: String, default: "all", index: true },
    ran_at:              Date,
    session_count:       Number,
    k:                   Number,
    algorithm_agreement: Number,
    silhouette_score:    Number,
    k_rationale:         mongoose.Schema.Types.Mixed,
    clusters: [{
        id:            Number,
        label:         String,
        n:             Number,
        feature_means: mongoose.Schema.Types.Mixed
    }],
    kruskal_wallis: [{
        feature:     String,
        H_statistic: Number,
        p_value:     Number,
        effect_size: Number,
        significant: String
    }],
    click_summary: [{
        text:  String,
        tag:   String,
        count: Number
    }],
    ai_interpretation: {
        page_type:             String,
        site_summary:          String,
        cluster_stories:       mongoose.Schema.Types.Mixed,
        top_suggestions:       [String],
        data_note:             String,
        first_impression_note: String,
        device_comparison:     String
    }
}, { strict: false }), "analysis_results");

const BugReport = mongoose.model("BugReport", new mongoose.Schema({
    account_id:    { type: mongoose.Schema.Types.ObjectId, ref: "Account", required: true, index: true },
    clerk_user_id: { type: String, required: true, index: true },
    site_key:      { type: String, required: true, index: true },
    email:         String,
    category:      { type: String, enum: ["bug", "account", "billing", "suggestion", "other"], default: "bug" },
    description:   { type: String, required: true, maxlength: 5000 },
    dashboard_section: String,
    page_url:      String,
    user_agent:    String,
    status:        { type: String, enum: ["open", "resolved"], default: "open", index: true },
    moderation:    { type: mongoose.Schema.Types.Mixed },
    moderation_history: { type: [mongoose.Schema.Types.Mixed], default: [] },
    created_at:    { type: Date, default: Date.now, index: true }
}).index({ "moderation_history.requestId": 1 }, { unique: true, sparse: true }), "bug_reports");

// Daily visit and click counts per real page path, kept small so per-page lists work at any size.
const pageDaySchema = new mongoose.Schema({
    site_key: { type: String, required: true },
    page:     { type: String, required: true },
    path:     { type: String, required: true },
    day:      { type: String, required: true },
    sessions: { type: Number, default: 0 },
    desktop:  { type: Number, default: 0 },
    mobile:   { type: Number, default: 0 },
    clicks:   { type: Number, default: 0 },
    // Visits that reached each goal, by goal ID.
    goals:    { type: mongoose.Schema.Types.Mixed }
}, { versionKey: false });
pageDaySchema.index({ site_key: 1, page: 1, path: 1, day: 1 }, { unique: true });
pageDaySchema.index({ site_key: 1, day: 1 });
const PageDay = mongoose.model("PageDay", pageDaySchema, "page_days");

const PageShot = mongoose.model("PageShot", new mongoose.Schema({
    site_key:     { type: String, required: true },
    page:         { type: String, required: true },
    device:       { type: String, enum: ["desktop", "mobile"], required: true },
    address:      String,
    file:         String,
    width:        Number,
    page_height:  Number,
    shown_height: Number,
    taken_at:     Date,
    viewed_at:    Date,
    error:        String,
    last_error:   String
}).index({ site_key: 1, page: 1, device: 1 }, { unique: true }), "page_shots");

const AccountDeletion = mongoose.model("AccountDeletion", new mongoose.Schema({
    clerk_user_id: { type: String, required: true, unique: true },
    account_id: mongoose.Schema.Types.ObjectId,
    references: { type: [String], index: true },
    requested_at: { type: Date, required: true },
    state: { type: String, enum: ["pending", "retrying", "complete"], default: "pending" },
    next_attempt_at: Date,
    lease_until: Date,
    alerts_cursor: mongoose.Schema.Types.Mixed,
    alerts_erased_at: Date,
    completed_at: Date,
    expires_at: { type: Date, expires: 0 }
}), "account_deletions");

module.exports = { Account, Session, AnalysisResult, BugReport, PageDay, PageShot, AccountDeletion };
