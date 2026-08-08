const logger = require("../lib/logger");

function buildInterpretationPrompt({ clusters, kwResults, clickSummary, kRationale, sessionCount, pageUrl, firstImpression, mobileResult }) {
    const dataConfidence = sessionCount < 50
        ? "small (under 50 sessions) -- treat findings as directional, not conclusive"
        : sessionCount < 200
        ? "moderate (50-200 sessions) -- patterns are meaningful but will sharpen with more data"
        : "solid (200+ sessions) -- findings are reliable";

    const sigFeatures    = kwResults.filter(r => r.significant === "yes");
    const nonSigFeatures = kwResults.filter(r => r.significant !== "yes");
    const sigContext     = sigFeatures.length > 0
        ? sigFeatures.map(r => `  ${r.feature} (H=${r.H_statistic?.toFixed(1)}, p=${r.p_value < 0.001 ? "<0.001" : r.p_value?.toFixed(3)})`).join("\n")
        : "  none at p<0.05";
    const nonSigContext  = nonSigFeatures.map(r => r.feature).join(", ");

    const totalN = clusters.reduce((s, c) => s + (c.n || 0), 0);
    const clusterDescriptions = [...clusters]
        .sort((a, b) => b.n - a.n)
        .map(c => {
            const means = c.feature_means || {};
            const fmt   = v => (typeof v === "number" ? v.toFixed(3) : "n/a");
            const pct   = totalN > 0 ? ((c.n / totalN) * 100).toFixed(0) : 0;
            return `Cluster ${c.id} -- ${pct}% of sessions (n=${c.n}):\n` +
                `  pause_rate:          ${fmt(means.pause_rate)} pauses/sec\n` +
                `  click_rate:          ${fmt(means.click_rate)} clicks/sec\n` +
                `  move_density:        ${fmt(means.move_density)} moves/sec\n` +
                `  dwell_before_click:  ${fmt(means.dwell_before_click)} ms\n` +
                `  spatial_entropy:     ${fmt(means.spatial_entropy)} (0-2.2 scale)\n` +
                `  top_zone_ratio:      ${fmt(means.top_zone_ratio)}\n` +
                `  centre_zone_ratio:   ${fmt(means.centre_zone_ratio)}\n` +
                `  bottom_zone_ratio:   ${fmt(means.bottom_zone_ratio)}\n` +
                `  avg_cursor_velocity: ${fmt(means.avg_cursor_velocity)} px/ms`;
        }).join("\n\n");

    const clickLines = clickSummary.length > 0
        ? clickSummary.map(c => `  "${c.text}" (${c.tag}) -- ${c.count} clicks`).join("\n")
        : "  No click element data.";

    const clusterStoriesTemplate = clusters.map(c =>
        `    "${c.id}": {\n` +
        `      "headline": "4-6 word label specific to this visitor type. Not generic. Drawn from what makes this group statistically distinct.",\n` +
        `      "body": "2-3 sentences. First: what this group does on the page in plain language. Second: what that behaviour pattern tells you about their intent or mindset. Third: why this matters for the page. No em dashes. No technical terms.",\n` +
        `      "suggestions": ["[Evidence from this group] + [Specific page change] + [Why it addresses their behaviour]. No generic advice.", "Second only if clearly supported."]\n` +
        `    }`
    ).join(",\n");

    return `CRITICAL WRITING RULES -- violate any of these and the output is unusable:
1. Never use em dashes (--) or en dashes. Use a period or restructure the sentence instead. If you are about to write "--" stop and rewrite.
2. Never use technical feature names (no "spatial entropy", "pause_rate", "move_density", "zone ratio", "cluster", "dwell"). Translate to plain language.
3. Never suggest changes to the analysis pipeline or data collection. Only suggest page changes: copy, layout, design, content, calls to action.
4. Every UX suggestion must follow this structure: (a) what the visitor behaviour shows, (b) the specific design change, (c) why that change addresses the behaviour. Vague suggestions are not acceptable.
5. Be concise and direct. Cut every word that does not add meaning. The site_summary should be 2-3 tight sentences. Each cluster body should be 2 sentences maximum. Each suggestion should be one clear sentence. If you have made your point, stop.
6. Write like a confident analyst, not a consultant trying to fill a report. Say what you mean plainly.

You are a senior UX analyst interpreting web session behaviour data from TraceTray, a cursor-tracking analytics platform.

TraceTray extracts these signals from mouse movement:
- pause_rate: cursor pauses per second -- higher means more reading or hesitation
- click_rate: clicks per second -- higher means more interactive
- move_density: mouse moves per second -- higher means more active exploration
- dwell_before_click: milliseconds between last pause and a click -- higher means more deliberation before acting
- spatial_entropy: how broadly the cursor spread across the page (0=concentrated, 2.2=fully spread)
- top/centre/bottom_zone_ratio: fraction of cursor time in each vertical third of the page
- avg_cursor_velocity: cursor speed in pixels per millisecond

Sessions are grouped using KMeans clustering. Kruskal-Wallis tests determine which features statistically discriminate between groups.

DATASET
Page: ${pageUrl || "unknown"}
Sessions analysed: ${sessionCount}
Data confidence: ${dataConfidence}
k-selection basis: ${kRationale?.selection_basis || "silhouette score maximised within viable range"}

PAGE TYPE INFERENCE -- do this before interpreting anything else
Look at the URL path and the most clicked element text below. Infer what kind of page this is: homepage, pricing page, product or product listing page, checkout or cart, blog post or article, FAQ or help/docs page, about or company page, sign up or login page, or something else. Use this inference to shape your entire interpretation. The same behavioural pattern means different things on different page types:
- Low engagement and a fast exit on a FAQ or docs page often means the visitor found their answer quickly. That is a good outcome, not a problem.
- The same pattern on a pricing or checkout page usually means visitors are leaving without converting. That is worth flagging.
- High scrolling and reading depth on a blog post is expected and good. The same pattern on a checkout page may mean visitors are confused or stuck.
- Heavy clicking near the top of a product listing page suggests active browsing. The same pattern on a homepage may mean visitors cannot find what they are looking for.
State your inferred page type plainly in the dedicated field below. If the URL and click data give no useful signal, say the page type is unclear rather than guessing without basis.

STATISTICALLY SIGNIFICANT DISCRIMINATING FEATURES (p<0.05) -- base your labels primarily on these:
${sigContext}

NON-SIGNIFICANT FEATURES (do not over-weight in labels):
${nonSigContext || "none"}

CLUSTER PROFILES (sorted largest first):
${clusterDescriptions}

MOST CLICKED ELEMENTS ON THIS PAGE:
${clickLines}

FIRST IMPRESSION DATA (first 5 seconds of each session, compared against the rest of the same session):
${firstImpression && firstImpression.velocity_delta_pct != null
    ? `  Cursor velocity in the first 5 seconds is ${Math.abs(firstImpression.velocity_delta_pct).toFixed(0)}% ${firstImpression.velocity_delta_pct > 0 ? "faster" : "slower"} than the rest of the session.\n  Pauses in the first 5 seconds: ${firstImpression.early_pause_count}. Pauses in the rest of the session: ${firstImpression.rest_pause_count}.\n  Where early cursor activity concentrates: top ${(firstImpression.early_zone_breakdown.top*100).toFixed(0)}%, middle ${(firstImpression.early_zone_breakdown.middle*100).toFixed(0)}%, bottom ${(firstImpression.early_zone_breakdown.bottom*100).toFixed(0)}%.`
    : "  Not enough data to compare the first 5 seconds against the rest of the session."}

MOBILE VISITORS ON THIS PAGE (separate sessions, no cursor data -- touch and scroll signals only):
${mobileResult && mobileResult.clusters && mobileResult.clusters.length > 0
    ? (() => {
        const mTotal = mobileResult.clusters.reduce((s,c) => s+(c.n||0), 0);
        return `  ${mTotal} mobile sessions analysed, grouped into ${mobileResult.clusters.length} mobile visitor types:\n` +
            mobileResult.clusters.sort((a,b) => b.n - a.n).map(c => {
                const m = c.feature_means || {};
                const pct = mTotal > 0 ? ((c.n/mTotal)*100).toFixed(0) : 0;
                return `  - ${c.label} (${pct}% of mobile sessions, n=${c.n}): tap rate ${(m.tap_rate||0).toFixed(3)}/sec, ` +
                    `scroll depth reached ${(((m.scroll_depth_reached ?? m.scroll_depth_norm) || 0)*100).toFixed(0)}% of the page, ` +
                    `reading pause rate ${((m.attention_pause_rate ?? m.scroll_pause_rate) || 0).toFixed(3)}/sec, ` +
                    `average reading pause ${((m.avg_attention_pause_ms||0)/1000).toFixed(1)} seconds`;
            }).join("\n");
    })()
    : "  No mobile sessions analysed for this page yet."}

VISITOR ARCHETYPE VOCABULARY -- use as a starting point, coin new labels when data warrants:
- "Deep Reader" -- high pause rate, low velocity, concentrated spatial entropy
- "Deliberate Clicker" -- high dwell before click, moderate pause rate
- "Active Explorer" -- high move density, high click rate, high spatial entropy
- "Header Scanner" -- high top zone ratio, low engagement depth
- "Content Skimmer" -- low pause rate, high velocity, broad spatial coverage
- "Passive Visitor" -- low move density, low click rate
- "Engaged Converter" -- high click rate, moderate dwell, centre/bottom zone focus
- "Hesitant Browser" -- high dwell before click, low click rate
- "Scroll Depth Visitor" -- high bottom zone ratio relative to top
- "Navigation Focused" -- high click rate concentrated in top zone

YOUR TASK
Produce a JSON object with this exact structure. Ground every label in the statistically significant features. Be honest about uncertainty. Be specific.

{
  "page_type": "Your inferred page type in 2-4 words, e.g. 'Pricing page', 'FAQ or help page', 'Product listing page', 'Homepage', 'Checkout flow'. Use 'Unclear' if the URL and click data give no real signal.",
  "site_summary": "2-3 tight sentences. What the dominant visitor behaviour is, what it tells you about how this page is landing, and the single most important thing the data reveals. Interpret the behaviour in light of the inferred page type rather than generically. This should describe the page as a whole, primarily grounded in the desktop data since that is the larger and more detailed dataset. No padding. No em dashes.",
  "cluster_stories": {
${clusterStoriesTemplate}
  },
  "top_suggestions": [
    "Format: [What the data shows] + [Specific design change] + [Expected outcome]. Example: The majority of visitors read deeply before acting, which means your strongest conversion argument should appear in the lower half of the page where their attention actually is. Move the primary CTA and pricing to appear after your key differentiators rather than at the top.",
    "Second priority change in the same format, or omit if not clearly supported by the data."
  ],
  "data_note": "One honest sentence about what the current dataset size allows you to conclude and what requires more data.",
  "first_impression_note": "1-2 sentences interpreting the first impression data above. If cursor velocity is notably faster in the first 5 seconds, that usually means visitors are scanning or searching for something specific before settling in. If it is similar to the rest of the session, visitors orient quickly and engage right away. Be specific to the numbers given, not generic. If there is not enough data, say so plainly in one sentence.",
  "device_comparison": "2-3 sentences comparing how desktop and mobile visitors behave differently on this page, if mobile data is available. Ground this in the actual numbers (tap rate, page-relative scroll depth, reading pauses, and direction changes) compared against the desktop patterns above, not generic assumptions about mobile behaviour. If mobile data is not available yet, say plainly that there is not enough mobile traffic to compare yet, in one sentence, rather than guessing."
}

Return only the JSON object. No preamble, no markdown fences.`;
}

async function callAI(prompt) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        logger.warn("ANTHROPIC_API_KEY not set, skipping interpretation");
        return null;
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "Content-Type":      "application/json",
            "x-api-key":         apiKey,
            "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
            model:      "claude-sonnet-4-6",
            max_tokens: 2500,
            messages:   [{ role: "user", content: prompt }]
        })
    });

    if (!response.ok) throw new Error(`Anthropic API ${response.status}: ${await response.text()}`);

    const data  = await response.json();
    const text  = data.content?.find(b => b.type === "text")?.text || "";
    const clean = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    return JSON.parse(clean);
}

module.exports = { buildInterpretationPrompt, callAI };
