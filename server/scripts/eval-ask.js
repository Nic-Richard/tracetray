// Runs Ask on a fixed set of questions against a seeded site and checks the answers against the same data
// Ask's tools return, so a prompt or model change that makes answers worse shows up as failures.
// Each run makes real Anthropic calls (one Ask per case).
// docker compose exec server node scripts/eval-ask.js [site_key] [--only id,id] [--model name]
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });
const mongoose = require("mongoose");
const { MONGODB_URI } = require("../src/config");
const { Account } = require("../src/db/models");
const { askAnalytics, runTool, ASK_MODEL } = require("../src/lib/askAnalytics");

// The prompt allows 150; a little slack for markdown and numbers split by spaces.
const MAX_WORDS = 160;
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };

// A percentage written as a whole number, allowing one point either way for rounding.
const percent = share => {
    const n = Math.round(share * 100);
    return new RegExp(`\\b(${[n - 1, n, n + 1].join("|")})(\\.\\d)?\\s?(%|percent)`, "i");
};
const count = n => new RegExp(`\\b${n.toLocaleString("en-US").replace(/,/g, ",?")}\\b`);
const pathOf = page => new URL(page).pathname;
const homepage = /\bhome ?page\b|(^|[\s(“"'`])\/(?=[\s)”"'`,.]|$)/im;
const declines = topic => new RegExp(`(don'?t|doesn'?t|can'?t|cannot|isn'?t|aren'?t|not|no)\\b[^.]{0,80}\\b(${topic})|\\b(${topic})\\b[^.]{0,80}\\b(isn'?t|aren'?t|not)\\b`, "i");

const CASES = [
    {
        id: "busiest-page",
        question: "Which page gets the most visits?",
        tools: ["list_pages"],
        checks: async ({ pages }) => [{ label: "names the busiest page", test: pathOf(pages[0].page) === "/" ? homepage : new RegExp(pathOf(pages[0].page).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }]
    },
    {
        id: "group-size",
        question: "How many product pages does the site have?",
        tools: ["list_pages", "get_pages_in_group"],
        checks: async ({ product }) => [{ label: `says ${product.pages_in_group}`, test: count(product.pages_in_group) }]
    },
    {
        id: "goal-rate",
        question: "What share of product page visits added to cart in the last 30 days?",
        tools: ["get_goals"],
        checks: async ({ goals }) => [{ label: `rate ${Math.round(goals.goals[0].rate * 100)}%`, test: percent(goals.goals[0].rate) }]
    },
    {
        id: "best-week",
        question: "Which week was best for adding to cart on the product pages?",
        tools: ["get_goals"],
        checks: async ({ goals }) => {
            const day = new Date(`${goals.best_week.week}T00:00:00Z`);
            const month = day.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
            return [
                { label: `week of ${goals.best_week.week}`, test: new RegExp(`${month}\\w*\\.?\\s+${day.getUTCDate()}\\b|\\b${day.getUTCDate()}\\s+${month}|${goals.best_week.week}`, "i") },
                { label: `rate ${Math.round(goals.best_week.rate * 100)}%`, test: percent(goals.best_week.rate) }
            ];
        }
    },
    {
        id: "this-month",
        question: "How many visits has the site had this month?",
        tools: ["get_traffic_trend"],
        forbid: [{ label: "fall back to a rolling window", test: /last 30 days|30-day|calendar month isn'?t|doesn'?t (report|support|cover) (a )?calendar/i }],
        checks: async ({ thisMonth }) => [{ label: `${thisMonth.total_sessions.toLocaleString("en-US")} visits`, test: count(thisMonth.total_sessions) }]
    },
    {
        id: "last-month",
        question: "How many visits did the site get last month, and where did they come from?",
        tools: ["get_traffic_trend", "get_traffic_sources"],
        checks: async ({ lastMonth, lastMonthSources }) => {
            const external = lastMonthSources.sources.filter(s => !s.source.startsWith("internal"));
            return [
                { label: `${lastMonth.total_sessions.toLocaleString("en-US")} visits`, test: count(lastMonth.total_sessions) },
                { label: `top source ${external[0].source}`, test: new RegExp(external[0].source.split(".")[0], "i") }
            ];
        }
    },
    {
        id: "landing",
        question: "Where do most visitors land first?",
        tools: ["get_visitor_journeys"],
        checks: async ({ journeys }) => [{ label: "names the top entry page", test: pathOf(journeys.top_entries[0].page) === "/" ? homepage : /product/i }]
    },
    {
        id: "exits",
        question: "Where do visitors most often leave the site?",
        tools: ["get_visitor_journeys"],
        checks: async ({ journeys }) => [{ label: "names the top exit page", test: /\/products\/|product pages?/i, skip: !journeys.top_exits[0].page.includes("/products/") }]
    },
    {
        id: "sources",
        question: "Apart from moving between my own pages, where does my traffic come from?",
        tools: ["get_traffic_sources"],
        checks: async ({ sources }) => {
            const external = sources.sources.filter(s => !s.source.startsWith("internal"));
            return [{ label: `top source ${external[0].source}`, test: new RegExp(external[0].source.split(".")[0], "i") }];
        }
    },
    {
        id: "home-clicks",
        question: "What do people click most on the homepage?",
        tools: ["get_top_clicks"],
        checks: async ({ clicks }) => [{ label: `“${clicks[0].text}”`, test: new RegExp(clicks[0].text, "i") }]
    },
    {
        id: "home-attention",
        question: "Which part of the homepage gets the most attention?",
        tools: ["get_attention"],
        checks: async () => [{ label: "says the top", test: /\btop\b|first screen|above the fold/i }]
    },
    {
        id: "groups",
        question: "Why don't some visitors on the product pages add to cart?",
        tools: ["get_overview"],
        forbid: [{ label: "invent revenue", test: /\brevenue\b[^.]{0,40}\$\s?\d/i }],
        checks: async ({ overview }) => {
            const a = overview.latest_analysis || {};
            const types = [...(a.desktop_visitor_types || []), ...(a.mobile_visitor_types || [])].filter(t => !/without interacting/i.test(t.label));
            const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            return [{ label: "names a visitor group", test: new RegExp(types.map(t => escape(t.label)).join("|"), "i") }];
        }
    },
    {
        id: "revenue",
        question: "How much revenue did the product pages bring in last month?",
        tools: [],
        forbid: [{ label: "state a revenue figure", test: /\$\s?\d{1,3}(,\d{3})+|\$\s?\d{4,}/ }],
        checks: async () => [{ label: "says revenue isn't tracked", test: declines("revenue|sales|money|order value|prices|purchase amounts") }]
    },
    {
        id: "demographics",
        question: "What age and gender are my visitors?",
        tools: [],
        forbid: [{ label: "state demographics", test: /\b\d{1,2}\s?%[^.]{0,30}\b(male|female|men|women)\b|\baged? \d{2}/i }],
        checks: async () => [{ label: "says it can't know", test: declines("age|gender|who (they|your visitors) are|demographic|personal") }]
    }
];

async function groundTruth(siteKey, siteHost) {
    const tool = (name, input) => runTool(siteKey, name, input, { siteHost });
    const pages = (await tool("list_pages", {})).sort((a, b) => b.sessions - a.sessions);
    const productPage = pages.find(p => p.page.includes("/products/"))?.page;
    const homePage = pages.find(p => pathOf(p.page) === "/")?.page;
    const now = new Date();
    const monthOf = offset => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1)).toISOString().slice(0, 7);
    return {
        thisMonth: await tool("get_traffic_trend", { month: monthOf(0) }),
        lastMonth: await tool("get_traffic_trend", { month: monthOf(1) }),
        lastMonthSources: await tool("get_traffic_sources", { month: monthOf(1) }),
        pages,
        product: await tool("get_pages_in_group", { page: productPage }),
        goals: await tool("get_goals", { page: productPage, days: 30 }),
        journeys: await tool("get_visitor_journeys", {}),
        sources: await tool("get_traffic_sources", {}),
        clicks: await tool("get_top_clicks", { page: homePage, limit: 5 }),
        overview: await tool("get_overview", { page: productPage })
    };
}

(async () => {
    await mongoose.connect(MONGODB_URI);
    const requested = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : null;
    const account = requested
        ? await Account.findOne({ "sites.key": requested }).lean()
        : await Account.findOne({ "sites.goals.0": { $exists: true } }).sort({ created_at: -1 }).lean();
    if (!account) throw new Error("no site with goals found; seed the demo first");
    const site = account.sites.find(s => s.key === requested) || account.sites.find(s => s.goals?.length);
    const siteHost = new URL(site.url || `https://${site.domain}`).host;
    const only = arg("--only")?.split(",");
    const model = arg("--model") || ASK_MODEL;

    const truth = await groundTruth(site.key, siteHost);
    const cases = CASES.filter(c => !only || only.includes(c.id));
    const totals = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    let passed = 0;
    console.log(`Ask eval: ${cases.length} cases on ${site.name} (${site.key}) with ${model}\n`);

    for (const c of cases) {
        const { answer, toolsUsed, usage } = await askAnalytics({ siteKey: site.key, siteName: site.name, siteHost, question: c.question, model });
        for (const key of Object.keys(totals)) totals[key] += usage[key] || 0;
        const results = [];
        if (c.tools.length) results.push({ label: `used ${c.tools.join(" or ")}`, ok: c.tools.some(t => toolsUsed.includes(t)) });
        for (const check of await c.checks(truth)) if (!check.skip) results.push({ label: check.label, ok: check.test.test(answer) });
        for (const rule of c.forbid || []) results.push({ label: `doesn't ${rule.label}`, ok: !rule.test.test(answer) });
        const words = answer.split(/\s+/).filter(Boolean).length;
        results.push({ label: `${words} words (max ${MAX_WORDS})`, ok: words <= MAX_WORDS });
        const ok = results.every(r => r.ok);
        if (ok) passed++;
        console.log(`${ok ? "PASS" : "FAIL"}  ${c.id.padEnd(15)} ${results.map(r => `${r.ok ? "✓" : "✗"} ${r.label}`).join(" · ")}`);
        if (!ok || process.argv.includes("--verbose")) console.log(`      tools: ${toolsUsed.join(", ") || "none"}\n      ${answer.replace(/\s+/g, " ").slice(0, 600)}\n`);
    }

    console.log(`\n${passed}/${cases.length} passed. Tokens: ${totals.input_tokens} in, ${totals.output_tokens} out, ${totals.cache_read_input_tokens} cache read, ${totals.cache_creation_input_tokens} cache write.`);
    await mongoose.disconnect();
    process.exitCode = passed === cases.length ? 0 : 1;
})().catch(err => {
    console.error(err.message);
    process.exit(1);
});
