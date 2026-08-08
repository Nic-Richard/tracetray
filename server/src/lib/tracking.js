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

module.exports = { getRegistrableDomain, normalizeTrackingDomain };
