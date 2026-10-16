// Collects desktop cursor activity and mobile touch and scroll activity.
// Wrapped so its names never clash with the host page; window.sessionData and window.sendTestSession are
// the only things it exposes.
(function () {
// A second copy of the script on the same page would record every event twice.
if (window.__traceTrayLoaded) return;
window.__traceTrayLoaded = true;

function generateId() {
    if (crypto && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return "xxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === "x" ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Uses explicit tracker config when provided, otherwise infers the collection endpoint.
function resolveConfig() {
    const cfg      = window.TraceTray || {};
    let   endpoint = cfg.endpoint || null;

    if (!endpoint) {
        const scripts = document.querySelectorAll("script[src]");
        for (const s of scripts) {
            if (s.src && s.src.includes("tracker.js")) {
                try { endpoint = new URL("/collect", s.src).href; break; } catch(e) {}
            }
        }
    }

    return {
        endpoint: endpoint || "https://tracetray.com/collect",
        siteKey:  cfg.key  || null
    };
}

const { endpoint: COLLECT_URL, siteKey: SITE_KEY } = resolveConfig();

// TraceTray stores nothing on the visitor's device; the server works out a daily visitor ID instead.
// Older versions kept an ID in localStorage, so it's removed for visitors who still have one.
try {
    localStorage.removeItem("tt_vid");
    localStorage.removeItem("tt_vid_last_active");
} catch(e) {}
let sessionId    = generateId();
let sessionStart = Date.now();

// Avoid classifying touch-capable laptops as mobile when the primary pointer is a mouse.
const IS_MOBILE = ('ontouchstart' in window) && window.matchMedia('(pointer: coarse)').matches;
const DEVICE_TYPE = IS_MOBILE ? "mobile" : "desktop";

// Ignore query strings and ordinary anchor hashes when grouping pages.
function normalisePage(url) {
    try {
        const u = new URL(url);
        const routeHash = /^#!?\//.test(u.hash) ? u.hash.split("?")[0] : "";
        return u.origin + u.pathname + routeHash;
    } catch(e) {
        return url;
    }
}

// The link or button a click belongs to, so a click on an icon inside a button still names the button.
// Links keep only their path on this site, the domain elsewhere, or the scheme (mailto:, tel:), never a query.
const ACTIONABLE = "a[href], button, [role='button'], input[type='submit'], input[type='button'], summary, label";

function actionTarget(el) {
    const found = el && el.closest ? el.closest(ACTIONABLE) : null;
    if (!found) return null;
    let href = null;
    if (found.tagName === "A") {
        try {
            const u = new URL(found.href, window.location.href);
            if (!/^https?:$/.test(u.protocol)) href = u.protocol;
            else href = u.origin === window.location.origin ? u.pathname : u.hostname;
        } catch(e) {}
    }
    const text = (found.innerText || found.value || found.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 80);
    return { tag: found.tagName, id: found.id || null, text: text || null, href: href };
}

const sessionData = {
    session_id:  sessionId,
    device_type: DEVICE_TYPE,
    page:        normalisePage(window.location.href),
    referrer:    document.referrer ? normalisePage(document.referrer) : null,
    start_time:  sessionStart,
    end_time:    null,
    events:      []
};

let unsentEvents = [];

function resetSession(page, referrer) {
    sessionId = generateId();
    sessionStart = Date.now();
    sessionData.session_id = sessionId;
    sessionData.page = page;
    sessionData.referrer = referrer;
    sessionData.start_time = sessionStart;
    sessionData.end_time = null;
    sessionData.events = [];
    unsentEvents = [];
    sessionExported = false;
    lastScrollY = window.scrollY;
    lastScrollTime = Date.now();
    resetMobileAttention();
}

function logEvent(type, data) {
    const event = {
        type: type,
        timestamp: Date.now(),
        ...data
    };
    sessionData.events.push(event);
    unsentEvents.push(event);
}

function sendBatch(isFinal = false) {
    if (unsentEvents.length === 0 && !isFinal) return;

    if (!SITE_KEY) {
        unsentEvents = [];
        return;
    }

    const now = Date.now();

    const payload = {
        session_id:  sessionData.session_id,
        device_type: sessionData.device_type,
        key:         SITE_KEY,
        page:        sessionData.page,
        referrer:    sessionData.referrer,
        start_time:  sessionData.start_time,
        end_time: isFinal ? now : undefined,
        // Include the summary only in the final batch.
        summary: isFinal ? {
            duration_ms:    now - sessionData.start_time,
            total_events:   sessionData.events.length,
            mouse_moves:    sessionData.events.filter(e => e.type === "mousemove").length,
            cursor_pauses:  sessionData.events.filter(e => e.type === "cursor_pause").length,
            clicks:         sessionData.events.filter(e => e.type === "click").length,
            scrolls:        sessionData.events.filter(e => e.type === "scroll").length,
            taps:           sessionData.events.filter(e => e.type === "tap").length,
            scroll_pauses:  sessionData.events.filter(e => e.type === "scroll_pause").length,
            attention_pauses: sessionData.events.filter(e => e.type === "attention_pause").length
        } : undefined,
        events: unsentEvents
    };

    const body = JSON.stringify(payload);
    // fetch with keepalive instead of sendBeacon: EasyPrivacy blocks every third-party ping
    // (*$ping,third-party), and beacons are pings. text/plain and omitted credentials keep it a
    // simple cross-origin request with no preflight.
    fetch(COLLECT_URL, {
        method: "POST",
        body,
        keepalive: true,
        credentials: "omit",
        headers: { "Content-Type": "text/plain;charset=UTF-8" }
    }).catch(() => navigator.sendBeacon(COLLECT_URL, new Blob([body], { type: "text/plain;charset=UTF-8" })));

    unsentEvents = [];
}

setInterval(() => sendBatch(false), 3000);


function getPageMetrics() {
    const doc = document.documentElement;
    const pageHeight = Math.max(doc.scrollHeight, document.body ? document.body.scrollHeight : 0, window.innerHeight);
    const viewportHeight = window.innerHeight;
    const scrollY = window.scrollY;

    return {
        scroll_depth: Math.min(1, (scrollY + viewportHeight) / pageHeight),
        viewport_midpoint: scrollY + viewportHeight / 2,
        page_height: pageHeight,
        viewport_height: viewportHeight
    };
}

// Measured once the page has loaded: before that the page is no taller than the window, so it reads as fully scrolled.
function logPageLoad() {
    logEvent("page_load", { page: normalisePage(window.location.href), ...getPageMetrics(), measured: true });
}
if (document.readyState === "complete") logPageLoad();
else window.addEventListener("load", logPageLoad, { once: true });

function handleRouteChange() {
    const nextPage = normalisePage(window.location.href);
    if (nextPage === sessionData.page) return;

    const previousPage = sessionData.page;
    exportSession();
    resetSession(nextPage, previousPage);
    logEvent("page_load", { page: normalisePage(window.location.href), ...getPageMetrics() });
}

for (const method of ["pushState", "replaceState"]) {
    const original = history[method];
    history[method] = function() {
        const result = original.apply(this, arguments);
        handleRouteChange();
        return result;
    };
}

window.addEventListener("popstate", handleRouteChange);
window.addEventListener("hashchange", () => {
    if (/^#!?\//.test(window.location.hash)) handleRouteChange();
});

// Skip synthetic mouse events on touch-first devices.
if (!IS_MOBILE) {
    let lastMoveTime = Date.now();
    let lastMoveLogged = 0;
    let lastX = null;
    let lastY = null;
    let pauseJustLogged = false;

    const MOVE_SAMPLE_RATE = 50;  // ms - how often to log a move event
    const PAUSE_THRESHOLD = 300;  // ms - how long the cursor needs to sit still to count as a pause
    const MIN_MOVE_DIST = 5;      // px - ignore tiny jitter below this distance

    document.addEventListener("mousemove", (e) => {
        const now = Date.now();
        const pauseDuration = now - lastMoveTime;

        if (pauseDuration > PAUSE_THRESHOLD) {
            logEvent("cursor_pause", {
                duration: pauseDuration,
                x: e.clientX,
                y: e.clientY,
                py: e.pageY
            });
            pauseJustLogged = true;
        }

        if (now - lastMoveLogged < MOVE_SAMPLE_RATE) return;

        if (lastX !== null) {
            const dx = e.clientX - lastX;
            const dy = e.clientY - lastY;
            if (Math.sqrt(dx * dx + dy * dy) < MIN_MOVE_DIST) {
                lastMoveTime = now;
                return;
            }
        }

        if (pauseJustLogged) {
            pauseJustLogged = false;
            lastMoveTime = now;
            lastMoveLogged = now;
            return;
        }

        logEvent("mousemove", {
            x: e.clientX,
            y: e.clientY,
            py: e.pageY,
            delta_t: pauseDuration  // time since last move, used for velocity in feature extraction
        });

        lastX = e.clientX;
        lastY = e.clientY;
        lastMoveLogged = now;
        lastMoveTime = now;
    });

    document.addEventListener("click", (e) => {
        const target = e.target;
        if (target.tagName === "BODY") return;

        logEvent("click", {
            x: e.clientX,
            y: e.clientY,
            py: e.pageY,
            tag: target.tagName,
            id: target.id || null,
            classes: target.className || null,
            text: target.innerText ? target.innerText.slice(0, 50) : null,
            target: actionTarget(target),
            page: window.location.pathname
        });
    });
}

let lastScrollY = window.scrollY;
let lastScrollTime = Date.now();
const SCROLL_SAMPLE_RATE = 100;
const ATTENTION_PAUSE_THRESHOLD = 300;
const MAX_ATTENTION_PAUSE = 30000;
let attentionTimer = null;
let openAttentionPause = null;
let attentionContext = getPageMetrics();
window.addEventListener("load", () => { attentionContext = getPageMetrics(); }, { once: true });

function closeAttentionPause(endedBy) {
    clearTimeout(attentionTimer);
    attentionTimer = null;

    if (!openAttentionPause) return;

    openAttentionPause.duration = Math.min(Date.now() - openAttentionPause.timestamp, MAX_ATTENTION_PAUSE);
    openAttentionPause.ended_by = endedBy;
    unsentEvents.push(openAttentionPause);
    openAttentionPause = null;
}

function scheduleAttentionPause() {
    if (!IS_MOBILE || document.visibilityState === "hidden") return;

    clearTimeout(attentionTimer);
    attentionTimer = setTimeout(() => {
        const event = {
            type: "attention_pause",
            timestamp: Date.now() - ATTENTION_PAUSE_THRESHOLD,
            duration: ATTENTION_PAUSE_THRESHOLD,
            ...attentionContext
        };
        sessionData.events.push(event);
        openAttentionPause = event;
    }, ATTENTION_PAUSE_THRESHOLD);
}

function recordMobileInteraction(type) {
    if (!IS_MOBILE) return;
    closeAttentionPause(type);
    attentionContext = getPageMetrics();
    scheduleAttentionPause();
}

function resetMobileAttention() {
    clearTimeout(attentionTimer);
    attentionTimer = null;
    openAttentionPause = null;
    attentionContext = getPageMetrics();
    scheduleAttentionPause();
}

document.addEventListener("scroll", () => {
    const now = Date.now();
    recordMobileInteraction("scroll");

    if (now - lastScrollTime < SCROLL_SAMPLE_RATE) return;

    const metrics = getPageMetrics();
    logEvent("scroll", {
        from: lastScrollY,
        to: window.scrollY,
        delta: window.scrollY - lastScrollY,
        ...metrics
    });

    lastScrollY = window.scrollY;
    lastScrollTime = now;
});

if (IS_MOBILE) {
    function recordTap(target, x, y) {
        recordMobileInteraction("tap");
        if (!target || target.tagName === "BODY") return;

        logEvent("tap", {
            x: x,
            y: y,
            tag: target.tagName,
            id: target.id || null,
            classes: typeof target.className === "string" ? target.className : null,
            text: target.innerText ? target.innerText.slice(0, 50) : null,
            target: actionTarget(target),
            page: window.location.pathname,
            ...getPageMetrics()
        });
    }

    let touchStart = null;

    function isTap(x, y) {
        if (!touchStart) return false;
        const dx = x - touchStart.x;
        const dy = y - touchStart.y;
        const duration = Date.now() - touchStart.time;
        touchStart = null;
        return Math.sqrt(dx * dx + dy * dy) <= 12 && duration <= 700;
    }

    if (window.PointerEvent) {
        document.addEventListener("pointerdown", (e) => {
            if (e.pointerType !== "touch") return;
            touchStart = { x: e.clientX, y: e.clientY, time: Date.now() };
        }, { passive: true });
        document.addEventListener("pointerup", (e) => {
            if (e.pointerType !== "touch" || !isTap(e.clientX, e.clientY)) return;
            recordTap(e.target, e.clientX, e.clientY);
        }, { passive: true });
        document.addEventListener("pointercancel", () => {
            touchStart = null;
        }, { passive: true });
    } else {
        document.addEventListener("touchstart", (e) => {
            const touch = e.touches && e.touches[0];
            if (!touch) return;
            touchStart = { x: touch.clientX, y: touch.clientY, time: Date.now() };
        }, { passive: true });
        document.addEventListener("touchend", (e) => {
            const touch = e.changedTouches && e.changedTouches[0];
            if (!touch || !isTap(touch.clientX, touch.clientY)) return;
            recordTap(e.target, touch.clientX, touch.clientY);
        }, { passive: true });
        document.addEventListener("touchcancel", () => {
            touchStart = null;
        }, { passive: true });
    }

    scheduleAttentionPause();
}


let sessionExported = false;

function exportSession() {
    if (sessionExported) return;
    closeAttentionPause("session_end");
    sessionExported = true;
    sendBatch(true);
}

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
        exportSession();
    } else if (IS_MOBILE) {
        attentionContext = getPageMetrics();
        scheduleAttentionPause();
    }
});

// A sent form, named by its id, name and where it posts (same rules as links). Never any field or its value.
document.addEventListener("submit", (e) => {
    const form = e.target;
    if (!form || form.tagName !== "FORM") return;
    let action = null;
    try {
        const u = new URL(form.getAttribute("action") || window.location.href, window.location.href);
        action = /^https?:$/.test(u.protocol) ? (u.origin === window.location.origin ? u.pathname : u.hostname) : u.protocol;
    } catch(err) {}
    logEvent("form_submit", { form: { id: form.id || null, name: form.getAttribute("name") || null, action: action } });
}, true);

window.addEventListener("pagehide", () => exportSession());

window.sendTestSession = exportSession;

window.sessionData = sessionData;
})();
