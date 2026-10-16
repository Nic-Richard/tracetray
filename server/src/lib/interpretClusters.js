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
    scroll_burst_rate: {
        kind: "rate",
        up:   { adj: "Stop-start", noun: "scrollers", say: (c, b) => asMuch(c / b, "scroll in bursts") }
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

const ARCHETYPES = {
    desktop: [
        {
            key: "deep_readers", name: "Deep readers", traits: { pause_rate: 1, avg_cursor_velocity: -1 },
            meaning: "They're reading closely, so the words on this page matter to them."
        },
        {
            key: "hesitant", name: "Hesitant browsers", traits: { dwell_before_click: 1, click_rate: -1 },
            meaning: "They take a long time to decide and often don't click at all, which can mean the options aren't clear."
        },
        {
            key: "deliberate", name: "Deliberate clickers", traits: { dwell_before_click: 1, click_rate: 1 },
            meaning: "They take their time, then act."
        },
        {
            key: "explorers", name: "Active explorers", traits: { move_density: 1, click_rate: 1, spatial_entropy: 1 },
            meaning: "They move around and click a lot, which usually means they're looking for something."
        },
        {
            key: "header_scanners", name: "Header scanners", traits: { top_zone_ratio: 1, scroll_depth_reached: -1 },
            meaning: "They stay in the top section and rarely go further down."
        },
        {
            key: "skimmers", name: "Content skimmers", traits: { pause_rate: -1, avg_cursor_velocity: 1 },
            meaning: "They move fast and rarely stop, so they're skimming rather than reading."
        },
        {
            key: "passive", name: "Passive visitors", traits: { move_density: -1, click_rate: -1 },
            meaning: "They barely interact. Some read without touching the mouse; others leave the page open in another tab."
        },
        {
            key: "bottom_readers", name: "Bottom-of-page readers", traits: { bottom_zone_ratio: 1, scroll_depth_reached: 1 },
            meaning: "They spend most of their time further down the page."
        },
        {
            key: "quick_deciders", name: "Quick deciders", traits: { click_rate: 1, dwell_before_click: -1 },
            meaning: "They know what they want and click fast."
        },
        {
            key: "rechecking", name: "Re-checkers", traits: { direction_change_rate: 1 },
            meaning: "They scroll back up to look again, often to compare options or find something they missed."
        },
        {
            key: "window_shoppers", name: "Window shoppers", traits: { scroll_depth_reached: 1, click_rate: -1 },
            meaning: "They look through the whole page but rarely click anything."
        },
        {
            key: "searchers", name: "Searchers", traits: { move_density: 1, spatial_entropy: 1, click_rate: -1 },
            meaning: "They move all over the page without clicking much, as if looking for something they can't find."
        },
        {
            key: "methodical", name: "Methodical readers", traits: { pause_rate: 1, scroll_depth_reached: 1, avg_cursor_velocity: -1 },
            meaning: "They work through the page slowly and read most of it."
        },
        {
            key: "speed_scrollers", name: "Speed scrollers", traits: { scroll_burst_rate: 1, pause_rate: -1 },
            meaning: "They scroll in quick bursts and rarely stop."
        },
        {
            key: "comparers", name: "Comparison shoppers", traits: { direction_change_rate: 1, click_rate: 1 },
            meaning: "They go back and forth and click between options."
        }
    ],
    mobile: [
        {
            key: "m_readers", name: "Mobile readers", traits: { attention_pause_rate: 1, scroll_velocity_rate: -1 },
            meaning: "They stop scrolling often to read."
        },
        {
            key: "m_skimmers", name: "Thumb skimmers", traits: { scroll_velocity_rate: 1, attention_pause_rate: -1 },
            meaning: "They flick through the page quickly without stopping much."
        },
        {
            key: "m_tappers", name: "Active tappers", traits: { tap_rate: 1, scroll_depth_reached: 1 },
            meaning: "They scroll far and tap a lot, so they're engaged and exploring."
        },
        {
            key: "m_quick_exits", name: "Quick exits", traits: { tap_rate: -1, scroll_depth_reached: -1 },
            meaning: "They barely scroll or tap before leaving."
        },
        {
            key: "m_hesitant", name: "Hesitant tappers", traits: { dwell_before_tap: 1, tap_rate: -1 },
            meaning: "They take a long time before tapping, and tap rarely."
        },
        {
            key: "m_rechecking", name: "Re-checkers", traits: { direction_change_rate: 1 },
            meaning: "They scroll back up to look again."
        },
        {
            key: "m_deep", name: "Deep scrollers", traits: { scroll_depth_reached: 1 },
            meaning: "They make it most of the way down the page."
        },
        {
            key: "m_window_shoppers", name: "Window shoppers", traits: { scroll_depth_reached: 1, tap_rate: -1 },
            meaning: "They scroll through the whole page but rarely tap anything."
        },
        {
            key: "m_speed", name: "Speed scrollers", traits: { scroll_burst_rate: 1, attention_pause_rate: -1 },
            meaning: "They scroll in quick bursts and rarely stop."
        },
        {
            key: "m_lingering", name: "Lingering readers", traits: { avg_attention_pause_ms: 1, attention_pause_rate: 1 },
            meaning: "They stop often, and for a long time, to read."
        },
        {
            key: "m_first_screen", name: "First-screen readers", traits: { attention_pause_rate: 1, scroll_depth_reached: -1 },
            meaning: "They read what's on the first screens and rarely go further."
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

// "Top-of-page readers": the second strongest trait describes the strongest one. Traits that already named
// another group are skipped, so two groups aren't both called after scrolling back up.
function composedName(strong, usedFeatures) {
    const fresh = strong.filter(t => !usedFeatures.has(t.feature));
    const pick = fresh.length ? fresh : strong;
    // Avoids names like "Click-happy clickers".
    const name = (adj, noun) => adj.toLowerCase().includes(noun.slice(0, 3).toLowerCase()) ? `${adj} visitors` : `${adj} ${noun}`;
    if (pick.length >= 2 && pick[1].side.adj !== pick[0].side.adj) return name(pick[1].side.adj, pick[0].side.noun);
    return name(pick[0].side.adj, pick[0].side.noun);
}

function describeCluster(cluster, base, significance, archetypes, taken, used) {
    const traits = clusterTraits(cluster, base, significance);
    const strong = traits.filter(t => Math.abs(t.z) >= STRONG && t.side);
    const evidence = strong.slice(0, 3).map(t => t.side.say(t.value, t.average));
    const traitData = strong.slice(0, 4).map(t => ({
        feature: t.feature, value: t.value, page_average: t.average, description: t.side.say(t.value, t.average)
    }));

    if (strong.length === 0) {
        const body = "They behave close to the page average on every measure, so they're the baseline the other groups are compared with.";
        return { key: "typical", headline: "Typical visitors", traits: traitData, body, summary: body, suggestions: [] };
    }

    const archetype = matchArchetype(traits, archetypes, taken);
    let headline = archetype ? archetype.name : composedName(strong, used.features);
    if (used.names.has(headline)) headline = composedName(strong.slice(1).length ? strong.slice(1) : strong, used.features);
    if (used.names.has(headline)) headline = `${headline} (group ${cluster.id + 1})`;
    if (archetype) taken.add(archetype.key);
    used.names.add(headline);
    for (const feature of archetype ? Object.keys(archetype.traits) : [strong[0].feature]) used.features.add(feature);

    const meaning = archetype?.meaning || "";
    const body = `They ${evidence.join(", ").replace(/, ([^,]*)$/, " and $1")}. ${meaning}`.trim();
    return { key: archetype?.key || "composed", headline, body, summary: meaning, traits: traitData, suggestions: [] };
}

// A group's goal rate against the page's. "above" or "below" only when the gap is about two standard errors
// or more, so small groups don't get called winners or losers by chance.
function goalStanding(cluster, goal, average) {
    const n = cluster.n || 0;
    const reached = cluster.goal_hits?.[goal.id] || 0;
    const rate = n ? reached / n : 0;
    const spread = Math.sqrt(Math.max(average * (1 - average), 1e-6) / Math.max(n, 1));
    const z = (rate - average) / spread;
    return { rate, average, reached, standing: z >= 2 ? "above" : z <= -2 ? "below" : "about" };
}

function goalSentence(standing, goal, deviceLabel) {
    const against = `against ${pct(standing.average)} of ${deviceLabel} visits`;
    if (standing.standing === "above") return `${pct(standing.rate)} of them reach ${goal.name}, ${against}, so what they rely on is working.`;
    if (standing.standing === "below") return standing.reached === 0 ? `None of them reach ${goal.name}, ${against}.` : `Only ${pct(standing.rate)} of them reach ${goal.name}, ${against}.`;
    return "";
}

// A clear gap on the goal is the most useful thing to know about a group, so it leads the description.
function addGoal(story, standing, goal, deviceLabel) {
    story.goal = { name: goal.name, ...standing };
    const sentence = goalSentence(standing, goal, deviceLabel);
    if (!sentence) return;
    story.body = `${sentence} ${story.body}`;
}

// What the goal is, as a thing on the page ("the link to /products/"), or reaching a page ("going on to Order placed").
function goalTarget(goal) {
    const match = goal?.match || {};
    if (goal?.type === "click") return match.href ? `the link to ${match.href}` : match.text ? `“${match.text}”` : `#${match.id}`;
    if (goal?.type === "form") return "the form";
    return `going on to ${goal?.name}`;
}

const clickLabel = target => target.text ? `“${target.text}”` : target.href ? `the link to ${target.href}` : `#${target.id}`;

function isGoalTarget(goal, target) {
    const match = goal?.type === "click" ? goal.match || {} : {};
    if (match.id) return target.id === match.id;
    if (match.href) return target.href === match.href;
    if (match.text) return String(target.text || "").toLowerCase() === String(match.text).toLowerCase();
    return false;
}

const ratio = (cluster, base, feature) => {
    const value = cluster.feature_means?.[feature], average = base.means[feature];
    return typeof value === "number" && average > 0 ? value / average : null;
};

// Only a group that clearly falls short of the goal gets a suggestion, and only when its numbers say why:
// it leaves before reaching the goal on the page, it mostly clicks something else, or it hesitates.
// Anything vaguer is left to the site owner reading the groups.
function adviceFor(cluster, story, base, goal, deviceLabel, visits) {
    const standing = story.goal;
    if (!goal || standing?.standing !== "below") return null;
    const target = goalTarget(goal);
    const group = story.headline.toLowerCase();
    const who = `${story.headline} (${pct((cluster.n || 0) / visits)} of ${deviceLabel} visits)`;
    const reach = standing.reached === 0 ? `none of them reach ${goal.name}` : `only ${pct(standing.rate)} reach ${goal.name}`;
    const vs = `against ${pct(standing.average)} overall`;

    const depth = cluster.feature_means?.scroll_depth_reached;
    const position = goal.position?.[deviceLabel === "mobile" ? "mobile" : "desktop"];
    if (typeof depth === "number" && typeof position === "number" && depth + 0.05 < position) {
        return {
            action: `Move ${target} higher, or repeat it before ${pct(depth)} of the way down.`,
            evidence: `${who} leave about ${pct(depth)} of the way down, but ${target} sits at about ${pct(position)}, so ${reach} (${vs}).`
        };
    }
    const rival = (cluster.top_clicks || []).find(t => t.share >= 0.25 && !isGoalTarget(goal, t));
    if (rival) {
        return {
            action: `Look at ${clickLabel(rival)}: ${group} ${deviceLabel === "mobile" ? "tap" : "click"} it instead of ${target}.`,
            evidence: `${pct(rival.share)} of ${group} (${pct((cluster.n || 0) / visits)} of ${deviceLabel} visits) ${deviceLabel === "mobile" ? "tap" : "click"} ${clickLabel(rival)}, and ${reach} (${vs}).`,
            rival: clickLabel(rival)
        };
    }
    const wait = ratio(cluster, base, deviceLabel === "mobile" ? "dwell_before_tap" : "dwell_before_click");
    const waitMs = cluster.feature_means?.[deviceLabel === "mobile" ? "dwell_before_tap" : "dwell_before_click"];
    if (goal.type !== "page" && wait !== null && wait >= 1.5 && waitMs >= 1000) {
        return {
            action: `Make it clearer what ${target} leads to; ${group} hesitate before acting.`,
            evidence: `${who} wait about ${secs(waitMs)} before ${deviceLabel === "mobile" ? "tapping" : "clicking"}, ${wait.toFixed(1)}× the page average, and ${reach} (${vs}).`
        };
    }
    return null;
}

function describeDevice(result, archetypes, deviceLabel, goal = null) {
    const clusters = (result?.clusters || []).filter(c => (c.n || 0) > 0);
    if (clusters.length === 0) return null;
    const base = baselines(clusters);
    const significance = new Set((result.kruskal_wallis || []).filter(r => r.significant === "yes").map(r => r.feature));
    const taken = new Set(), used = { names: new Set(), features: new Set() };
    // Largest groups claim archetypes first.
    const ordered = [...clusters].sort((a, b) => (b.n || 0) - (a.n || 0));
    const stories = {};
    for (const c of ordered) stories[c.id] = describeCluster(c, base, significance, archetypes, taken, used);

    // With a goal and enough visits reaching it, groups are judged by it, and suggestions start with the
    // groups falling furthest short. The average counts every visit on the device, including those that
    // never interacted and so aren't in any group.
    let priority = ordered, goalAverage = null;
    const grouped = clusters.reduce((sum, c) => sum + (c.goal_hits?.[goal?.id] || 0), 0);
    const reached = grouped + (result.inactive_goal_hits?.[goal?.id] || 0);
    const visits = base.total + (result.inactive_count || 0);
    if (goal && reached >= 5) {
        const average = goalAverage = reached / visits;
        const standings = Object.fromEntries(clusters.map(c => [c.id, goalStanding(c, goal, average)]));
        for (const c of clusters) addGoal(stories[c.id], standings[c.id], goal, deviceLabel);
        const missing = c => (c.n || 0) * Math.max(0, average - standings[c.id].rate);
        priority = [...ordered].sort((a, b) => missing(b) - missing(a) || (b.n || 0) - (a.n || 0));
    }
    const advice = [];
    if (result.structure !== "none") {
        for (const c of priority) {
            const item = adviceFor(c, stories[c.id], base, goal, deviceLabel, visits);
            if (item) { stories[c.id].suggestions = [item.action]; advice.push({ ...item, device: deviceLabel, group: stories[c.id].headline }); }
        }
    }
    const alike = result.structure === "none" ? alikeNote(result, deviceLabel, goal, goalAverage) : null;
    return { stories, ordered, priority, base, visits, alike, advice, structure: result.structure || null };
}

function alikeNote(result, label, goal, goalAverage) {
    const depth = weightedMean(result, "scroll_depth_reached");
    const actions = weightedMean(result, label === "mobile" ? "tap_rate" : "click_rate");
    const parts = [`No split into groups held up for ${label} visitors on this page, so they're treated as one.`];
    if (depth != null && actions != null) parts.push(`On average they get ${pct(depth)} of the way down the page and ${label === "mobile" ? "tap" : "click"} about ${(actions * 60).toFixed(1)} times a minute.`);
    if (goal && goalAverage != null) parts.push(`${pct(goalAverage)} of ${label} visits reach ${goal.name}.`);
    return parts.join(" ");
}

function dataNote(result) {
    const n = result?.session_count || 0;
    const visits = `${n.toLocaleString("en-US")} desktop visit${n === 1 ? "" : "s"} with cursor movement`;
    if (result?.structure === "none") return `Based on ${visits}. Every split was checked against groupless data and on samples of the visits, and none held up.`;
    if (n < 50) return `Based on ${visits}, so treat these groups as early signals that may change as more visitors arrive.`;
    if (result?.structure === "some") return `Based on ${visits}. The groups overlap, so read the differences between them as tendencies rather than sharp lines.`;
    if (result?.structure === "clear") return `Based on ${visits}. The groups are well separated and held up when re-checked on samples of the data.`;
    if (n < 200) return `Based on ${visits}. The patterns are meaningful and will sharpen with more traffic.`;
    return `Based on ${visits}, which is enough to rely on these groups.`;
}

function firstImpressionNote(fi) {
    let note = null;
    const delta = fi?.velocity_delta_pct;
    if (delta != null) {
        if (delta > 20) note = `In the first five seconds visitors move the cursor ${Math.round(delta)}% faster than later on, which usually means they're scanning for something specific before settling in.`;
        else if (delta < -20) note = `Visitors move ${Math.round(-delta)}% slower in the first five seconds than later on, so they stop to take in the opening section.`;
        else note = "Visitors move at about the same pace in the first five seconds as later on, so they settle in quickly.";
    } else if (fi?.early_pauses_per_min != null && fi.rest_pauses_per_min > 0) {
        const ratio = fi.early_pauses_per_min / fi.rest_pauses_per_min;
        if (ratio >= 1.5) note = "Visitors pause more often in the first five seconds than later on, so they stop to take in the opening section.";
        else if (ratio <= 0.67) note = "Visitors pause less in the first five seconds than later on, so they get moving straight away.";
        else note = "Visitors pause about as often in the first five seconds as later on.";
    }
    if (!note) return "There aren't enough longer desktop visits yet to compare the first five seconds with the rest of the visit.";
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
    const Label = label.charAt(0).toUpperCase() + label.slice(1);
    if (device.structure === "none") return `${Label} visitors behave much alike on this page, so they aren't split into groups.`;
    const [first, second] = device.ordered;
    const share = c => pct((c.n || 0) / device.visits);
    const a = device.stories[first.id];
    let text = `${share(first)} of ${label} visitors are ${a.headline.toLowerCase()}.`;
    if (a.goal && a.goal.standing !== "about") text += ` ${a.body.split(". ")[0].replace(/\.$/, "")}.`;
    else if (a.key !== "typical" && a.traits[0]) text += ` They ${a.traits[0].description}.`;
    if (second) text += ` Another ${share(second)} are ${device.stories[second.id].headline.toLowerCase()}.`;
    return text;
}

function interpretClusters({ desktop, mobile = null, pageUrl = null, firstImpression = null, goal = null }) {
    const pageType = guessPageType(pageUrl);
    const d = describeDevice(desktop, ARCHETYPES.desktop, "desktop", goal);
    const m = describeDevice(mobile, ARCHETYPES.mobile, "mobile", goal);
    // The same finding on phones adds nothing once desktop has it.
    const advice = [...(d?.advice || [])];
    for (const item of m?.advice || []) {
        if (!advice.some(a => (a.rival && a.rival === item.rival) || a.action === item.action)) advice.push(item);
    }
    advice.splice(2);

    let siteSummary = summarise(d, "desktop");
    if (d?.structure === "none" && m?.structure === "none") siteSummary = "Desktop and phone visitors behave much alike on this page, so they aren't split into groups.";
    else if (m) siteSummary = `${siteSummary} ${summarise(m, "mobile")}`.trim();

    return {
        source: "rules",
        page_type: PAGE_TYPES[pageType],
        site_summary: siteSummary || "Not enough visitors yet to describe how people use this page.",
        cluster_stories: d?.stories || {},
        mobile_cluster_stories: m?.stories || {},
        top_suggestions: advice.map(a => a.action),
        advice,
        alike: { desktop: d?.alike || null, mobile: m?.alike || null },
        data_note: dataNote(desktop),
        first_impression_note: firstImpressionNote(firstImpression),
        device_comparison: deviceComparison(desktop, mobile)
    };
}

module.exports = { interpretClusters, guessPageType, ARCHETYPES, TRAITS };
