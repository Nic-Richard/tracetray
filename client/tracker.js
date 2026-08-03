function generateId() {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }

    return "xxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, character => {
        const random = Math.random() * 16 | 0;
        const value = character === "x" ? random : (random & 0x3 | 0x8);
        return value.toString(16);
    });
}

function resolveConfig() {
    const config = window.TraceTray || {};
    let endpoint = config.endpoint || null;

    if (!endpoint) {
        for (const script of document.querySelectorAll("script[src]")) {
            if (!script.src.includes("tracker.js")) continue;

            try {
                endpoint = new URL("/collect", script.src).href;
                break;
            } catch {}
        }
    }

    return {
        endpoint: endpoint || "https://tracetray.com/collect",
        siteKey: config.key || null
    };
}

function normalisePage(value) {
    try {
        const url = new URL(value, window.location.href);
        const routeHash = /^#!?\//.test(url.hash) ? url.hash : "";
        return `${url.origin}${url.pathname}${routeHash}`;
    } catch {
        return String(value || "");
    }
}

function getOrCreateVisitorId() {
    try {
        const storageKey = "tt_vid";
        let visitorId = localStorage.getItem(storageKey);

        if (!visitorId) {
            visitorId = generateId();
            localStorage.setItem(storageKey, visitorId);
        }

        return visitorId;
    } catch {
        return generateId();
    }
}

const { endpoint: COLLECT_URL, siteKey: SITE_KEY } = resolveConfig();
const VISITOR_ID = getOrCreateVisitorId();
const IS_MOBILE = "ontouchstart" in window
    && window.matchMedia("(pointer: coarse)").matches;
const DEVICE_TYPE = IS_MOBILE ? "mobile" : "desktop";

let currentSession = null;
let unsentEvents = [];
let sessionClosed = false;

let lastMoveTime = Date.now();
let lastMoveLogged = 0;
let lastX = null;
let lastY = null;
let pauseJustLogged = false;

let lastScrollY = window.scrollY;
let lastScrollTime = Date.now();
let lastScrollEventTime = Date.now();

const MOVE_SAMPLE_RATE = 50;
const PAUSE_THRESHOLD = 300;
const MIN_MOVE_DIST = 5;
const SCROLL_SAMPLE_RATE = 100;
const SCROLL_PAUSE_THRESHOLD = 800;

function resetInteractionState() {
    const now = Date.now();

    lastMoveTime = now;
    lastMoveLogged = 0;
    lastX = null;
    lastY = null;
    pauseJustLogged = false;

    lastScrollY = window.scrollY;
    lastScrollTime = now;
    lastScrollEventTime = now;
}

function createSession(page, referrer) {
    currentSession = {
        session_id: generateId(),
        visitor_id: VISITOR_ID,
        device_type: DEVICE_TYPE,
        page,
        referrer,
        start_time: Date.now(),
        events: []
    };

    unsentEvents = [];
    sessionClosed = false;
    resetInteractionState();
    logEvent("page_load", { page });
}

function logEvent(type, data = {}) {
    if (!currentSession || sessionClosed) return;

    const event = {
        type,
        timestamp: Date.now(),
        ...data
    };

    currentSession.events.push(event);
    unsentEvents.push(event);
}

function buildSummary(endTime) {
    const events = currentSession.events;

    return {
        duration_ms: endTime - currentSession.start_time,
        total_events: events.length,
        mouse_moves: events.filter(event => event.type === "mousemove").length,
        cursor_pauses: events.filter(event => event.type === "cursor_pause").length,
        clicks: events.filter(event => event.type === "click").length,
        scrolls: events.filter(event => event.type === "scroll").length,
        taps: events.filter(event => event.type === "tap").length,
        scroll_pauses: events.filter(event => event.type === "scroll_pause").length
    };
}

function sendBatch(isFinal = false) {
    if (!currentSession || sessionClosed) return;
    if (!isFinal && unsentEvents.length === 0) return;

    if (!SITE_KEY) {
        unsentEvents = [];
        if (isFinal) sessionClosed = true;
        return;
    }

    const endTime = Date.now();
    const payload = {
        session_id: currentSession.session_id,
        visitor_id: currentSession.visitor_id,
        device_type: currentSession.device_type,
        key: SITE_KEY,
        page: currentSession.page,
        referrer: currentSession.referrer,
        start_time: currentSession.start_time,
        end_time: isFinal ? endTime : undefined,
        summary: isFinal ? buildSummary(endTime) : undefined,
        events: unsentEvents.slice()
    };

    navigator.sendBeacon(
        COLLECT_URL,
        new Blob([JSON.stringify(payload)], { type: "application/json" })
    );

    unsentEvents = [];
    if (isFinal) sessionClosed = true;
}

function handleRouteChange() {
    const nextPage = normalisePage(window.location.href);
    if (!currentSession || nextPage === currentSession.page) return;

    const previousPage = currentSession.page;
    sendBatch(true);
    createSession(nextPage, previousPage);
}

function scheduleRouteCheck() {
    queueMicrotask(handleRouteChange);
}

function patchHistoryMethod(methodName) {
    const original = history[methodName];

    history[methodName] = function(...args) {
        const result = original.apply(this, args);
        scheduleRouteCheck();
        return result;
    };
}

patchHistoryMethod("pushState");
patchHistoryMethod("replaceState");

window.addEventListener("popstate", scheduleRouteCheck);
window.addEventListener("hashchange", scheduleRouteCheck);

if (!IS_MOBILE) {
    document.addEventListener("mousemove", event => {
        const now = Date.now();
        const pauseDuration = now - lastMoveTime;

        if (pauseDuration > PAUSE_THRESHOLD) {
            logEvent("cursor_pause", {
                duration: pauseDuration,
                x: event.clientX,
                y: event.clientY
            });
            pauseJustLogged = true;
        }

        if (now - lastMoveLogged < MOVE_SAMPLE_RATE) return;

        if (lastX !== null) {
            const deltaX = event.clientX - lastX;
            const deltaY = event.clientY - lastY;

            if (Math.hypot(deltaX, deltaY) < MIN_MOVE_DIST) {
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
            x: event.clientX,
            y: event.clientY,
            delta_t: pauseDuration
        });

        lastX = event.clientX;
        lastY = event.clientY;
        lastMoveLogged = now;
        lastMoveTime = now;
    });

    document.addEventListener("click", event => {
        const target = event.target;
        if (!(target instanceof Element) || target.tagName === "BODY") return;

        logEvent("click", {
            x: event.clientX,
            y: event.clientY,
            tag: target.tagName,
            id: target.id || null,
            classes: typeof target.className === "string" ? target.className : null,
            text: target.innerText ? target.innerText.slice(0, 50) : null,
            page: window.location.pathname
        });
    });
}

document.addEventListener("scroll", () => {
    const now = Date.now();

    if (IS_MOBILE) {
        const gap = now - lastScrollEventTime;

        if (gap > SCROLL_PAUSE_THRESHOLD) {
            logEvent("scroll_pause", {
                duration: gap,
                y: window.scrollY
            });
        }
    }

    lastScrollEventTime = now;

    if (now - lastScrollTime < SCROLL_SAMPLE_RATE) return;

    logEvent("scroll", {
        from: lastScrollY,
        to: window.scrollY,
        delta: window.scrollY - lastScrollY
    });

    lastScrollY = window.scrollY;
    lastScrollTime = now;
}, { passive: true });

if (IS_MOBILE) {
    document.addEventListener("touchend", event => {
        const touch = event.changedTouches?.[0];
        if (!touch) return;

        const target = document.elementFromPoint(touch.clientX, touch.clientY);
        if (!(target instanceof Element) || target.tagName === "BODY") return;

        logEvent("tap", {
            x: touch.clientX,
            y: touch.clientY,
            tag: target.tagName,
            id: target.id || null,
            classes: typeof target.className === "string" ? target.className : null,
            text: target.innerText ? target.innerText.slice(0, 50) : null,
            page: window.location.pathname
        });
    }, { passive: true });
}

setInterval(() => sendBatch(false), 3000);

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
        sendBatch(false);
    }
});

window.addEventListener("pagehide", () => sendBatch(true));

const initialReferrer = document.referrer
    ? normalisePage(document.referrer)
    : null;

createSession(normalisePage(window.location.href), initialReferrer);

window.sendTestSession = () => sendBatch(true);
Object.defineProperty(window, "sessionData", {
    get: () => currentSession
});
