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
        created_at: Date
    }],
    stripe_customer_id: String,
    plan:              { type: String, enum: ["starter", "pro", "none"], default: "none" },
    created_at:        Date
}, { strict: false }), "accounts");

const Session = mongoose.model("Session", new mongoose.Schema({
    site_key:    { type: String, index: true },
    visitor_id:  { type: String, index: true },
    device_type: { type: String, enum: ["desktop", "mobile"], default: "desktop", index: true },
    referrer:    String
}, { strict: false }), "sessions");

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
    created_at:    { type: Date, default: Date.now, index: true }
}), "bug_reports");

module.exports = { Account, Session, AnalysisResult, BugReport };
