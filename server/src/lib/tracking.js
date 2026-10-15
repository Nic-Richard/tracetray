const COMMON_SECOND_LEVEL_SUFFIXES = new Set([
    "ac.uk", "co.uk", "gov.uk", "ltd.uk", "me.uk", "net.uk", "org.uk", "plc.uk",
    "asn.au", "com.au", "edu.au", "gov.au", "id.au", "net.au", "org.au",
    "ac.nz", "co.nz", "geek.nz", "gen.nz", "kiwi.nz", "maori.nz", "net.nz", "org.nz",
    "ac.jp", "co.jp", "go.jp", "ne.jp", "or.jp",
    "com.br", "net.br", "org.br",
    "com.cn", "net.cn", "org.cn",
    "co.in", "firm.in", "gen.in", "ind.in", "net.in", "org.in",
    "co.za", "net.za", "org.za",
    "com.mx", "net.mx", "org.mx",
    "com.sg", "net.sg", "org.sg",
    "com.tr", "net.tr", "org.tr"
]);

function getRegistrableDomain(hostname) {
    const normalized = String(hostname || "")
        .toLowerCase()
        .replace(/\.$/, "")
        .replace(/^www\./, "");

    if (!normalized) return null;
    if (normalized === "localhost") return normalized;
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized)) return normalized;
    if (normalized.includes(":")) return normalized;

    const labels = normalized.split(".").filter(Boolean);
    if (labels.length <= 2) return normalized;

    const finalTwo = labels.slice(-2).join(".");
    if (COMMON_SECOND_LEVEL_SUFFIXES.has(finalTwo) && labels.length >= 3) {
        return labels.slice(-3).join(".");
    }

    return finalTwo;
}

function normalizeTrackingDomain(value) {
    try {
        const url = new URL(value);
        if (!["http:", "https:"].includes(url.protocol)) return null;
        return getRegistrableDomain(url.hostname);
    } catch {
        return null;
    }
}

// Everything below comes from the visitor's browser, so it's checked before it's stored.
const SUMMARY_FIELDS = ["duration_ms", "total_events", "mouse_moves", "cursor_pauses", "clicks", "scrolls", "taps", "scroll_pauses", "attention_pauses"];
const MAX_PAST_MS = 2 * 24 * 60 * 60 * 1000;
const MAX_AHEAD_MS = 10 * 60 * 1000;

function visitTime(value, now) {
    const ms = Number(value);
    return typeof value === "number" && Number.isFinite(ms) && ms > now - MAX_PAST_MS && ms < now + MAX_AHEAD_MS ? ms : now;
}

function cleanSummary(summary) {
    if (!summary || typeof summary !== "object") return undefined;
    return Object.fromEntries(SUMMARY_FIELDS.map(f => [f, Math.max(0, Number(summary[f]) || 0)]));
}

function cleanReferrer(value) {
    const raw = typeof value === "string" ? value.slice(0, 2000) : null;
    if (!raw) return null;
    try {
        const url = new URL(raw);
        if (!["http:", "https:"].includes(url.protocol)) return null;
        const routeHash = url.hash.startsWith("#/") || url.hash.startsWith("#!/") ? url.hash.split("?")[0] : "";
        return url.origin + url.pathname + routeHash;
    } catch {
        return null;
    }
}

module.exports = { getRegistrableDomain, normalizeTrackingDomain, visitTime, cleanSummary, cleanReferrer };
