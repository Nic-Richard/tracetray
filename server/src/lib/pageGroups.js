// Groups URLs that share a pattern ("/sets/:set") so a site with millions of pages gets a few groups.

const MAX_RULES = 50;
const SUGGEST_MIN_PAGES = 20;

const ID_PATTERNS = [
    /^\d+$/,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    /^[0-9a-f]{12,}$/i,
    // Base62 ids such as nanoid or Mongo-style tokens; needs digits so ordinary words are left alone.
    /^(?=(?:.*\d){2})(?=.*[A-Za-z])[A-Za-z0-9]{10,}$/
];

function isIdSegment(segment) {
    return ID_PATTERNS.some(pattern => pattern.test(segment));
}

function splitPage(pageUrl) {
    try {
        const url = new URL(pageUrl);
        return { origin: url.origin, path: url.pathname + (url.hash.startsWith("#/") || url.hash.startsWith("#!/") ? url.hash : "") };
    } catch {
        return { origin: "", path: String(pageUrl || "") };
    }
}

const segmentsOf = path => path.split("/").filter(Boolean);

function parseRule(pattern) {
    const value = String(pattern || "").trim();
    if (!value.startsWith("/") || value.length > 300) return null;
    const segments = segmentsOf(value);
    if (segments.length === 0 || segments.length > 12) return null;
    if (!segments.every(s => /^:[a-z][a-z0-9_]{0,30}$/i.test(s) || /^[^\s:*?#]+$/.test(s))) return null;
    if (!segments.some(s => s.startsWith(":"))) return null;
    return { pattern: "/" + segments.join("/"), segments, params: segments.filter(s => s.startsWith(":")).length };
}

function matchRule(segments, rule) {
    if (segments.length !== rule.segments.length) return false;
    return rule.segments.every((part, i) => part.startsWith(":") || part.toLowerCase() === segments[i].toLowerCase());
}

function groupPath(path, rules = []) {
    const segments = segmentsOf(path);
    // The rule with the fewest placeholders is the most specific, so "/sets/:set/edit" beats "/sets/:set/:tab".
    const matches = rules.map(parseRule).filter(Boolean).filter(rule => matchRule(segments, rule))
        .sort((a, b) => a.params - b.params);
    if (matches.length) return matches[0].pattern;
    if (!segments.some(isIdSegment)) return path || "/";
    return "/" + segments.map(s => (isIdSegment(s) ? ":id" : s)).join("/");
}

function groupPage(pageUrl, rules = []) {
    if (!pageUrl) return { page: pageUrl, path: null };
    const { origin, path } = splitPage(pageUrl);
    const grouped = groupPath(path, rules);
    return { page: origin + grouped, path };
}

const isGroup = page => /\/:[a-z]/i.test(splitPage(page).path);

function placeholderFor(segment) {
    const word = String(segment || "item").toLowerCase().replace(/[^a-z0-9]/g, "") || "item";
    if (word.endsWith("ies")) return `:${word.slice(0, -3)}y`;
    if (word.endsWith("s") && word.length > 3) return `:${word.slice(0, -1)}`;
    return `:${word}`;
}

// Finds path positions that take many different values under the same prefix, depth by depth.
function suggestRules(paths, existingRules = [], minPages = SUGGEST_MIN_PAGES) {
    let rows = [...new Set(paths)].map(path => segmentsOf(groupPath(path))).filter(s => s.length);
    const suggestions = new Map();
    const maxDepth = Math.min(12, Math.max(0, ...rows.map(r => r.length)));
    for (let depth = 0; depth < maxDepth; depth++) {
        const byPrefix = new Map();
        for (const row of rows) {
            if (row.length <= depth || row[depth].startsWith(":")) continue;
            const key = `${row.length}|${row.slice(0, depth).join("/")}`;
            if (!byPrefix.has(key)) byPrefix.set(key, new Set());
            byPrefix.get(key).add(row[depth]);
        }
        const variable = new Set([...byPrefix].filter(([, values]) => values.size >= minPages).map(([key]) => key));
        if (!variable.size) continue;
        rows = rows.map(row => {
            if (row.length <= depth || row[depth].startsWith(":")) return row;
            if (!variable.has(`${row.length}|${row.slice(0, depth).join("/")}`)) return row;
            const next = [...row];
            next[depth] = placeholderFor(depth > 0 ? row[depth - 1] : "page");
            return next;
        });
    }
    const existing = new Set(existingRules.map(parseRule).filter(Boolean).map(r => r.pattern));
    for (const row of rows) {
        // Rows whose only placeholders are automatic ids are already grouped without a rule.
        if (!row.some(s => s.startsWith(":") && s !== ":id")) continue;
        const pattern = "/" + row.join("/");
        if (existing.has(pattern) || row.every(s => s.startsWith(":"))) continue;
        suggestions.set(pattern, (suggestions.get(pattern) || 0) + 1);
    }
    return [...suggestions].map(([pattern, pages]) => ({ pattern, pages })).sort((a, b) => b.pages - a.pages);
}

module.exports = { groupPage, groupPath, splitPage, isGroup, isIdSegment, parseRule, suggestRules, MAX_RULES };
