// Names and explains visitor groups by comparing each cluster with its page's average.
// Deterministic: the same behaviour always gets the same name, so groups can be compared across runs.

const STRONG = 0.4;

const pct = v => `${Math.round(v * 100)}%`;
const secs = ms => `${(ms / 1000).toFixed(1)} s`;
function times(ratio) {
    if (ratio >= 1.95) return `${ratio.toFixed(1)}×`;
    if (ratio >= 1) return `${Math.round((ratio - 1) * 100)}% more`;
    return `${Math.round((1 - ratio) * 100)}% less`;
}
const asMuch = (ratio, verb) => ratio < 0.05 ? `hardly ever ${verb}` : ratio >= 1.95 ? `${verb} about ${times(ratio)} as often as average` : `${verb} about ${times(ratio)} often than average`;

// kind: "rate" compares by ratio, "share" by percentage points, "spread" on the 0-2.2 entropy scale.
const TRAITS = {
    pause_rate: {
        kind: "rate",
        up:   { adj: "Careful", noun: "readers", say: (c, b) => asMuch(c / b, "pause") },
        down: { adj: "Restless", noun: "skimmers", say: (c, b) => asMuch(c / b, "pause") }
    },
    click_rate: {
        kind: "rate",
        up:   { adj: "Click-happy", noun: "clickers", say: (c, b) => asMuch(c / b, "click") },
        down: { adj: "Hands-off", noun: "lookers", say: (c, b) => asMuch(c / b, "click") }
    },
    move_density: {
        kind: "rate",
        up:   { adj: "Busy", noun: "explorers", say: (c, b) => `move the cursor about ${times(c / b)} ${c / b >= 1.95 ? "as much as average" : "than average"}` },
        down: { adj: "Still", noun: "visitors", say: (c, b) => `move the cursor about ${times(c / b)} than average` }
    },
    avg_cursor_velocity: {
        kind: "rate",
        up:   { adj: "Fast", noun: "scanners", say: (c, b) => `move the cursor ${c / b >= 1.95 ? `about ${times(c / b)} as fast as` : `about ${times(c / b)} quickly than`} average` },
        down: { adj: "Slow", noun: "browsers", say: (c, b) => `move the cursor about ${Math.round((1 - c / b) * 100)}% more slowly than average` }
    },
    dwell_before_click: {
        kind: "rate",
        up:   { adj: "Hesitant", noun: "browsers", say: (c, b) => `wait about ${secs(c)} before clicking (page average ${secs(b)})` },
        down: { adj: "Decisive", noun: "deciders", say: (c, b) => `click after about ${secs(c)} (page average ${secs(b)})` }
    },
    spatial_entropy: {
        kind: "spread",
        up:   { adj: "Wide-ranging", noun: "roamers", say: () => "move the cursor across most of the page" },
        down: { adj: "Focused", noun: "visitors", say: () => "keep the cursor in one area of the page" }
    },
    top_zone_ratio: {
        kind: "share",
        up:   { adj: "Top-of-page", noun: "scanners", say: (c, b) => `spend ${pct(c)} of their cursor time in the top third (page average ${pct(b)})` }
    },
    centre_zone_ratio: {
        kind: "share",
        up:   { adj: "Mid-page", noun: "readers", say: (c, b) => `spend ${pct(c)} of their cursor time in the middle third (page average ${pct(b)})` }
    },
    bottom_zone_ratio: {
        kind: "share",
        up:   { adj: "Bottom-of-page", noun: "readers", say: (c, b) => `spend ${pct(c)} of their cursor time in the bottom third (page average ${pct(b)})` }
    },
    scroll_depth_reached: {
        kind: "share",
        up:   { adj: "Deep-scrolling", noun: "scrollers", say: (c, b) => `get ${pct(c)} of the way down the page (page average ${pct(b)})` },
        down: { adj: "Above-the-fold", noun: "visitors", say: (c, b) => `only get ${pct(c)} of the way down the page (page average ${pct(b)})` }
    },
    direction_change_rate: {
        kind: "rate",
        up:   { adj: "Re-checking", noun: "comparers", say: (c, b) => asMuch(c / b, "scroll back up") }
    },
    tap_rate: {
        kind: "rate",
        up:   { adj: "Tap-happy", noun: "tappers", say: (c, b) => asMuch(c / b, "tap") },
        down: { adj: "Hands-off", noun: "lookers", say: (c, b) => asMuch(c / b, "tap") }
    },
    scroll_velocity_rate: {
        kind: "rate",
        up:   { adj: "Fast-scrolling", noun: "skimmers", say: (c, b) => `scroll about ${times(c / b)} ${c / b >= 1.95 ? "as fast as average" : "quickly than average"}` },
        down: { adj: "Slow-scrolling", noun: "readers", say: (c, b) => `scroll about ${Math.round((1 - c / b) * 100)}% more slowly than average` }
    },
    attention_pause_rate: {
        kind: "rate",
        up:   { adj: "Careful", noun: "readers", say: (c, b) => asMuch(c / b, "stop to read") },
        down: { adj: "Restless", noun: "skimmers", say: (c, b) => asMuch(c / b, "stop to read") }
    },
    avg_attention_pause_ms: {
        kind: "rate",
        up:   { adj: "Lingering", noun: "readers", say: (c, b) => `stop for about ${secs(c)} at a time (page average ${secs(b)})` }
    },
    dwell_before_tap: {
        kind: "rate",
        up:   { adj: "Hesitant", noun: "tappers", say: (c, b) => `wait about ${secs(c)} before tapping (page average ${secs(b)})` },
        down: { adj: "Decisive", noun: "tappers", say: (c, b) => `tap after about ${secs(c)} (page average ${secs(b)})` }
    }
};

const PAGE_TYPES = {
    homepage: "Homepage", pricing: "Pricing page", product: "Product page", article: "Article or blog post",
    help: "Help or docs page", checkout: "Cart or checkout", signin: "Sign-up or sign-in page", other: "Unclear"
};

// Suggestions are picked by page type first, then the archetype's default.
const ARCHETYPES = {
    desktop: [
        {
            key: "deep_readers", name: "Deep readers", traits: { pause_rate: 1, avg_cursor_velocity: -1 },
            meaning: "They're reading closely, so the words on this page matter to them.",
            suggest: {
                default: "Put the point you most want them to take away in the text they're already reading, and keep the next step right after it.",
                article: "Add a clear next read or call to action at the end of the article, where these readers finish.",
                pricing: "Make plan differences easy to compare in the text; these visitors are reading the details."
            }
        },
        {
            key: "hesitant", name: "Hesitant browsers", traits: { dwell_before_click: 1, click_rate: -1 },
            meaning: "They take a long time to decide and often don't click at all, which can mean the options aren't clear.",
            suggest: {
                default: "Make the main button's label say exactly what happens next, and cut competing buttons near it.",
                pricing: "Spell out what each plan includes and costs, so the choice is quicker.",
                checkout: "Show the total, shipping and returns before the final button; doubt is what slows this group down.",
                signin: "Say what they get by signing up, right next to the form."
            }
        },
        {
            key: "deliberate", name: "Deliberate clickers", traits: { dwell_before_click: 1, click_rate: 1 },
            meaning: "They take their time, then act.",
            suggest: { default: "Keep the supporting detail they read right next to the buttons they end up clicking." }
        },
        {
            key: "explorers", name: "Active explorers", traits: { move_density: 1, click_rate: 1, spatial_entropy: 1 },
            meaning: "They move around and click a lot, which usually means they're looking for something.",
            suggest: {
                default: "Check the most clicked items. If clicks land on things that aren't links, make them clickable or add clearer navigation.",
                homepage: "Give them shortcuts to your most visited sections near the top of the page."
            }
        },
        {
            key: "header_scanners", name: "Header scanners", traits: { top_zone_ratio: 1, scroll_depth_reached: -1 },
            meaning: "They stay in the top section and rarely go further down.",
            suggest: { default: "Put your most important message and action in the top section, since this group may never see the rest." }
        },
        {
            key: "skimmers", name: "Content skimmers", traits: { pause_rate: -1, avg_cursor_velocity: 1 },
            meaning: "They move fast and rarely stop, so they're skimming rather than reading.",
            suggest: {
                default: "Use clear headings, short paragraphs and bold key phrases so a quick scan still gets the message across.",
                article: "Add a two-line summary at the top for readers who skim.",
                help: "Put the answer first and the explanation after it."
            }
        },
        {
            key: "passive", name: "Passive visitors", traits: { move_density: -1, click_rate: -1 },
            meaning: "They barely interact. Some read without touching the mouse; others leave the page open in another tab.",
            suggest: { default: "Make sure the first screen says what the page is for and what to do next; this group gives you very little time." }
        },
        {
            key: "bottom_readers", name: "Bottom-of-page readers", traits: { bottom_zone_ratio: 1, scroll_depth_reached: 1 },
            meaning: "They spend most of their time further down the page.",
            suggest: { default: "Repeat your main action lower on the page so they don't have to scroll back up to find it." }
        },
        {
            key: "quick_deciders", name: "Quick deciders", traits: { click_rate: 1, dwell_before_click: -1 },
            meaning: "They know what they want and click fast.",
            suggest: { default: "Keep their path short. Don't add steps between them and what they came for." }
        },
        {
            key: "rechecking", name: "Re-checkers", traits: { direction_change_rate: 1 },
            meaning: "They scroll back up to look again, often to compare options or find something they missed.",
            suggest: {
                default: "Keep key details like prices and options summarized near the main action so they don't have to scroll back.",
                pricing: "Add a comparison table, or keep a short plan summary in view while they scroll."
            }
        }
    ],
    mobile: [
        {
            key: "m_readers", name: "Mobile readers", traits: { attention_pause_rate: 1, scroll_velocity_rate: -1 },
            meaning: "They stop scrolling often to read.",
            suggest: { default: "Keep paragraphs short on mobile and put the next step right after the section they stop on." }
        },
        {
            key: "m_skimmers", name: "Thumb skimmers", traits: { scroll_velocity_rate: 1, attention_pause_rate: -1 },
            meaning: "They flick through the page quickly without stopping much.",
            suggest: { default: "Use bold headings and images that carry the message on their own, since this group barely stops." }
        },
        {
            key: "m_tappers", name: "Active tappers", traits: { tap_rate: 1, scroll_depth_reached: 1 },
            meaning: "They scroll far and tap a lot, so they're engaged and exploring.",
            suggest: { default: "Make sure tap targets are large and well spaced; this group is using them." }
        },
        {
            key: "m_quick_exits", name: "Quick exits", traits: { tap_rate: -1, scroll_depth_reached: -1 },
            meaning: "They barely scroll or tap before leaving.",
            suggest: { default: "Check what the first screen looks like on a phone; this group decides from it alone." }
        },
        {
            key: "m_hesitant", name: "Hesitant tappers", traits: { dwell_before_tap: 1, tap_rate: -1 },
            meaning: "They take a long time before tapping, and tap rarely.",
            suggest: { default: "Make the main button obvious on a small screen and say what happens when they tap it." }
        },
        {
            key: "m_rechecking", name: "Re-checkers", traits: { direction_change_rate: 1 },
            meaning: "They scroll back up to look again.",
            suggest: { default: "Keep a short summary of key details near the main button so they don't have to scroll back." }
        },
        {
            key: "m_deep", name: "Deep scrollers", traits: { scroll_depth_reached: 1 },
            meaning: "They make it most of the way down the page.",
            suggest: { default: "Put a clear action at the bottom of the page, where this group ends up." }
        }
    ]
};

function guessPageType(pageUrl) {
    let path = "";
    try { path = new URL(pageUrl).pathname.toLowerCase(); } catch { path = String(pageUrl || "").toLowerCase(); }
    if (!path) return "other";
    if (path === "/" || /^\/(index\.html?|home)?$/.test(path)) return "homepage";
    if (/(pricing|plans|subscribe|membership)/.test(path)) return "pricing";
    if (/(cart|checkout|basket|payment)/.test(path)) return "checkout";
    if (/(login|log-in|signin|sign-in|signup|sign-up|register)/.test(path)) return "signin";
    if (/(help|docs|faq|support|guide)/.test(path)) return "help";
    if (/(blog|post|article|news|stories)/.test(path)) return "article";
    if (/(product|item|shop|store|\/p\/)/.test(path)) return "product";
    return "other";
}

function baselines(clusters) {
    const total = clusters.reduce((s, c) => s + (c.n || 0), 0) || 1;
    const means = {};
    for (const feature of Object.keys(TRAITS)) {
        let sum = 0, weight = 0;
        for (const c of clusters) {
            const v = c.feature_means?.[feature];
            if (typeof v === "number" && Number.isFinite(v)) { sum += v * (c.n || 0); weight += c.n || 0; }
        }
        if (weight > 0) means[feature] = sum / weight;
    }
    return { means, total };
}

function strength(kind, value, base) {
    let z;
    if (kind === "rate") {
        if (!(base > 0)) return 0;
        z = value > 0 ? Math.log2(value / base) : -2;
    } else if (kind === "share") {
        z = (value - base) / 0.2;
    } else {
        z = (value - base) / 0.3;
    }
    return Math.max(-2, Math.min(2, z));
}

function clusterTraits(cluster, base, significance) {
    const traits = [];
    for (const [feature, def] of Object.entries(TRAITS)) {
        const value = cluster.feature_means?.[feature];
        const b = base.means[feature];
        if (typeof value !== "number" || typeof b !== "number") continue;
        // A group that (almost) never clicks or taps has no real wait before clicking, not a zero-second one.
        if ((feature === "dwell_before_click" || feature === "dwell_before_tap") && value < 100) continue;
        const z = strength(def.kind, value, b);
        const weight = significance.size === 0 || significance.has(feature) ? 1 : 0.5;
        const side = z > 0 ? def.up : def.down;
        traits.push({ feature, value, average: b, z, weight, side, score: Math.abs(z) * weight });
    }
    return traits.sort((a, b) => b.score - a.score);
}

function matchArchetype(traits, archetypes, taken) {
    const byFeature = Object.fromEntries(traits.map(t => [t.feature, t]));
    let best = null;
    for (const archetype of archetypes) {
        if (taken.has(archetype.key)) continue;
        const wanted = Object.entries(archetype.traits);
        let score = 0, ok = true;
        for (const [feature, sign] of wanted) {
            const t = byFeature[feature];
            const agreement = t ? sign * t.z : 0;
            if (agreement < 0.25) { ok = false; break; }
            score += Math.min(agreement, 1.5) * t.weight;
        }
        // Matching more traits is stronger evidence than one extreme trait.
        score = (score / wanted.length) * (0.85 + 0.15 * wanted.length);
        if (ok && score >= 0.5 && (!best || score > best.score)) best = { archetype, score };
    }
    return best?.archetype || null;
}

// "Top-of-page readers": the second strongest trait describes the strongest one.
function composedName(strong) {
    if (strong.length >= 2 && strong[1].side.adj !== strong[0].side.adj) return `${strong[1].side.adj} ${strong[0].side.noun}`;
    return `${strong[0].side.adj} ${strong[0].side.noun}`;
}

function describeCluster(cluster, base, significance, archetypes, taken, usedNames, pageType, deviceLabel) {
    const traits = clusterTraits(cluster, base, significance);
    const strong = traits.filter(t => Math.abs(t.z) >= STRONG && t.side);
    const share = base.total ? (cluster.n || 0) / base.total : 0;
    const evidence = strong.slice(0, 3).map(t => t.side.say(t.value, t.average));
    const traitData = strong.slice(0, 4).map(t => ({
        feature: t.feature, value: t.value, page_average: t.average, description: t.side.say(t.value, t.average)
    }));

    if (strong.length === 0) {
        return {
            key: "typical", headline: "Typical visitors", traits: traitData,
            body: `${pct(share)} of ${deviceLabel} visitors. They behave close to the page average on every measure, so they're the baseline the other groups are compared with.`,
            suggestions: []
        };
    }

    const archetype = matchArchetype(traits, archetypes, taken);
    let headline = archetype ? archetype.name : composedName(strong);
    if (usedNames.has(headline)) headline = composedName(strong.slice(1).length ? strong.slice(1) : strong);
    if (usedNames.has(headline)) headline = `${headline} (group ${cluster.id + 1})`;
    if (archetype) taken.add(archetype.key);
    usedNames.add(headline);

    const meaning = archetype?.meaning || "";
    const body = `${pct(share)} of ${deviceLabel} visitors. They ${evidence.join(", ").replace(/, ([^,]*)$/, " and $1")}. ${meaning}`.trim();
    const suggestion = archetype ? (archetype.suggest[pageType] || archetype.suggest.default) : null;
    return { key: archetype?.key || "composed", headline, body, traits: traitData, suggestions: suggestion ? [suggestion] : [] };
}

function describeDevice(result, archetypes, pageType, deviceLabel) {
    const clusters = (result?.clusters || []).filter(c => (c.n || 0) > 0);
    if (clusters.length === 0) return null;
    const base = baselines(clusters);
    const significance = new Set((result.kruskal_wallis || []).filter(r => r.significant === "yes").map(r => r.feature));
    const taken = new Set(), usedNames = new Set();
    // Largest groups claim archetypes first.
    const ordered = [...clusters].sort((a, b) => (b.n || 0) - (a.n || 0));
    const stories = {};
    for (const c of ordered) stories[c.id] = describeCluster(c, base, significance, archetypes, taken, usedNames, pageType, deviceLabel);
    return { stories, ordered, base };
}

function dataNote(sessionCount) {
    if (sessionCount < 50) return `Based on ${sessionCount} sessions, so treat these groups as early signals that may change as more visitors arrive.`;
    if (sessionCount < 200) return `Based on ${sessionCount} sessions. The patterns are meaningful and will sharpen with more traffic.`;
    return `Based on ${sessionCount} sessions, which is enough to rely on these groups.`;
}

function firstImpressionNote(fi) {
    if (!fi || fi.velocity_delta_pct == null) return "There isn't enough data yet to compare the first five seconds with the rest of the visit.";
    const delta = fi.velocity_delta_pct;
    let note;
    if (delta > 20) note = `In the first five seconds visitors move the cursor ${Math.round(delta)}% faster than later on, which usually means they're scanning for something specific before settling in.`;
    else if (delta < -20) note = `Visitors move ${Math.round(-delta)}% slower in the first five seconds than later on, so they stop to take in the opening section.`;
    else note = "Visitors move at about the same pace in the first five seconds as later on, so they settle in quickly.";
    const top = fi.early_zone_breakdown?.top;
    if (typeof top === "number" && top >= 0.6) note += ` Most of that early movement (${pct(top)}) is in the top third of the page.`;
    return note;
}

function weightedMean(result, feature) {
    const clusters = result?.clusters || [];
    let sum = 0, weight = 0;
    for (const c of clusters) {
        const v = c.feature_means?.[feature];
        if (typeof v === "number") { sum += v * (c.n || 0); weight += c.n || 0; }
    }
    return weight ? sum / weight : null;
}

function deviceComparison(desktop, mobile) {
    if (!mobile?.clusters?.length) return "There isn't enough mobile traffic on this page to compare devices yet.";
    const parts = [];
    const dDepth = weightedMean(desktop, "scroll_depth_reached"), mDepth = weightedMean(mobile, "scroll_depth_reached");
    if (dDepth != null && mDepth != null) parts.push(`Mobile visitors get ${pct(mDepth)} of the way down the page on average, versus ${pct(dDepth)} on desktop.`);
    const clicks = weightedMean(desktop, "click_rate"), taps = weightedMean(mobile, "tap_rate");
    if (clicks != null && taps != null) parts.push(`They tap about ${(taps * 60).toFixed(1)} times a minute, compared with ${(clicks * 60).toFixed(1)} clicks a minute on desktop.`);
    return parts.join(" ") || "Mobile and desktop visitors were analyzed separately; their measures aren't directly comparable on this page.";
}

function summarise(device, label) {
    if (!device) return "";
    const [first, second] = device.ordered;
    const share = c => pct((c.n || 0) / device.base.total);
    const a = device.stories[first.id];
    let text = `${share(first)} of ${label} visitors are ${a.headline.toLowerCase()}.`;
    if (a.key !== "typical" && a.traits[0]) text += ` They ${a.traits[0].description}.`;
    if (second) text += ` Another ${share(second)} are ${device.stories[second.id].headline.toLowerCase()}.`;
    return text;
}

function interpretClusters({ desktop, mobile = null, pageUrl = null, firstImpression = null }) {
    const pageType = guessPageType(pageUrl);
    const d = describeDevice(desktop, ARCHETYPES.desktop, pageType, "desktop");
    const m = describeDevice(mobile, ARCHETYPES.mobile, pageType, "mobile");

    const suggestions = [];
    for (const device of [d, m].filter(Boolean)) {
        for (const c of device.ordered) {
            for (const s of device.stories[c.id].suggestions) if (!suggestions.includes(s)) suggestions.push(s);
        }
    }

    let siteSummary = summarise(d, "desktop");
    if (m) siteSummary = `${siteSummary} ${summarise(m, "mobile")}`.trim();

    return {
        source: "rules",
        page_type: PAGE_TYPES[pageType],
        site_summary: siteSummary || "Not enough visitors yet to describe how people use this page.",
        cluster_stories: d?.stories || {},
        mobile_cluster_stories: m?.stories || {},
        top_suggestions: suggestions.slice(0, 2),
        data_note: dataNote(desktop?.session_count || 0),
        first_impression_note: firstImpressionNote(firstImpression),
        device_comparison: deviceComparison(desktop, mobile)
    };
}

module.exports = { interpretClusters, guessPageType, ARCHETYPES, TRAITS };
