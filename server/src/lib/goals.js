// Goals: what a page exists for. A click goal matches a link or button, a form goal a sent form, and a page goal
// a later page in the same journey. Pure functions only; marking visits and counting lives in goalHits.js.
const crypto = require("crypto");

const TYPES = ["click", "form", "page"];
const JOURNEY_GAP_MS = 30 * 60 * 1000;

const clean = value => typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
const sameText = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();

function newGoalId() {
    return "g" + crypto.randomBytes(6).toString("base64url");
}

// A page is named by its grouped address (a group or a single page) or its real one, so a goal survives
// pages being grouped or ungrouped later.
function pageNames(session) {
    const names = [];
    if (session.page) names.push(session.page);
    if (session.page && session.page_path) {
        try { names.push(new URL(session.page).origin + session.page_path); } catch { /* keep the grouped name only */ }
    }
    return names;
}

function appliesTo(goal, session) {
    if (!goal.pages?.length) return true;
    return pageNames(session).some(name => goal.pages.includes(name));
}

function isGoalPage(goal, session) {
    return goal.type === "page" && pageNames(session).includes(goal.match.page);
}

// The link or button a click belongs to; clicks from before the tracker recorded it fall back to the element.
function clickTarget(event) {
    if (event?.target && typeof event.target === "object") return event.target;
    return { tag: event?.tag, id: event?.id, text: event?.text, href: null };
}

function clickMatches(goal, event) {
    if (goal.type !== "click" || (event?.type !== "click" && event?.type !== "tap")) return false;
    const target = clickTarget(event);
    const match = goal.match;
    if (match.id) return target.id === match.id;
    if (match.href) return target.href === match.href;
    if (match.text) return sameText(target.text, match.text) && (!match.tag || String(target.tag || "").toUpperCase() === match.tag);
    return false;
}

function formMatches(goal, event) {
    if (goal.type !== "form" || event?.type !== "form_submit" || !event.form) return false;
    const match = goal.match, form = event.form;
    if (match.id) return form.id === match.id;
    if (match.name) return form.name === match.name;
    if (match.action) return form.action === match.action;
    return false;
}

// Click and form goals reached by one batch of a visit's events.
function eventHits(goals, session, events) {
    return goals.filter(goal => (goal.type === "click" || goal.type === "form") && appliesTo(goal, session)
        && events.some(e => clickMatches(goal, e) || formMatches(goal, e)))
        .map(goal => goal.id);
}

// Splits one visitor's visits (sorted by start) into journeys at 30-minute gaps.
function journeysOf(sessions) {
    const journeys = [];
    let current = null, lastActive = null;
    for (const s of sessions) {
        const start = Number(s.start_time) || 0;
        if (!current || start - lastActive > JOURNEY_GAP_MS) {
            current = [];
            journeys.push(current);
        }
        current.push(s);
        lastActive = Math.max(start, Date.parse(s.end_time) || start);
    }
    return journeys;
}

// For page goals: each earlier visit in a journey that later reaches the goal page. Returns session id -> goal ids.
function pageGoalMarks(goals, journey) {
    const marks = new Map();
    for (const goal of goals.filter(g => g.type === "page")) {
        const reachedAt = journey.findIndex(s => isGoalPage(goal, s));
        if (reachedAt <= 0) continue;
        for (const s of journey.slice(0, reachedAt)) {
            if (isGoalPage(goal, s) || !appliesTo(goal, s)) continue;
            marks.set(s.session_id, [...(marks.get(s.session_id) || []), goal.id]);
        }
    }
    return marks;
}

// Validates what the dashboard sends for a new or edited goal. Returns { goal } or { error }.
function parseGoal(input, existing = null) {
    const name = clean(input?.name).slice(0, 60);
    const type = existing?.type || input?.type;
    if (!TYPES.includes(type)) return { error: "pick a click, form or page goal" };
    if (!name) return { error: "give the goal a name" };

    const raw = input?.match || existing?.match || {};
    let match;
    if (type === "click") {
        match = {
            id: clean(raw.id).slice(0, 120) || null,
            href: clean(raw.href).slice(0, 2000) || null,
            text: clean(raw.text).slice(0, 80) || null,
            tag: clean(raw.tag).toUpperCase().slice(0, 20) || null
        };
        if (!match.id && !match.href && !match.text) return { error: "choose the button or link this goal is for" };
    } else if (type === "form") {
        match = {
            id: clean(raw.id).slice(0, 120) || null,
            name: clean(raw.name).slice(0, 120) || null,
            action: clean(raw.action).slice(0, 2000) || null
        };
        if (!match.id && !match.name && !match.action) return { error: "choose the form this goal is for" };
    } else {
        const page = clean(raw.page).slice(0, 2000);
        if (!/^https?:\/\//.test(page)) return { error: "choose the page this goal is for" };
        match = { page };
    }

    const pages = Array.isArray(input?.pages ?? existing?.pages)
        ? [...new Set((input?.pages ?? existing.pages).map(p => clean(p).slice(0, 2000)).filter(p => /^https?:\/\//.test(p)))].slice(0, 200)
        : [];
    // A target is the share of visits the site owner is aiming for; null clears it.
    const rawTarget = input && "target" in input ? input.target : existing?.target;
    const target = rawTarget === null || rawTarget === undefined || rawTarget === "" ? null : Number(rawTarget);
    if (target !== null && !(target > 0 && target <= 1)) return { error: "a target is a share of visits between 0% and 100%" };
    return { goal: { id: existing?.id || newGoalId(), name, type, match, pages, target } };
}

// Whether an edit changes which visits count, so past visits have to be checked again.
function matchChanged(before, after) {
    return JSON.stringify([before.match, [...(before.pages || [])].sort()]) !== JSON.stringify([after.match, [...(after.pages || [])].sort()]);
}

module.exports = { eventHits, clickMatches, formMatches, pageGoalMarks, journeysOf, appliesTo, isGoalPage, pageNames, parseGoal, matchChanged, JOURNEY_GAP_MS };
