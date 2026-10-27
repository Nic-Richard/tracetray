import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const { parseGoal } = createRequire(import.meta.url)("../../server/src/lib/goals.js");
const { findingSnapshot } = createRequire(import.meta.url)("../../server/src/lib/changeFinding.js");

const READS = new Set(["/api/config", "/api/pages", "/api/sites", "/api/stats", "/api/sessions/timeseries", "/api/goal-rates", "/api/goals", "/api/pages/members", "/api/usage", "/api/journey", "/api/ux-trends", "/api/goal-trend", "/api/attention-profile", "/api/page-shot", "/api/sessions/recent"]);

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32_000) throw new RangeError("fixture request too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createFixtureApi(upstreamFetch = fetch, { configDelayMs = 0, emailMode = "normal", deletionMode = "normal", comparisonMode = "normal", pathMode = "normal", pickerMode = "normal", memberMode = "normal", analysisMode = "disabled" } = {}) {
  let deletion = { state: "none" };
  let deletionAttempts = 0;
  const questions = [];
  const reports = [];
  const attempts = new Map();
  const websiteChanges = [];
  const goalChanges = [];
  const goalLists = new Map();
  const changeLists = new Map();
  const changeWrites = [];
  const pathLists = new Map();
  const pathWrites = [];
  const pathReads = [];
  const pageLists = new Map();
  const memberReads = [];
  let memberShrunk = false;
  let formReads = 0;
  let pickerPageReads = 0;
  const emailChanges = [];
  let emailReads = 0;
  const emailPrefs = { weekly_summary: false, shift_alerts: false, available: { weekly_summary: true, shift_alerts: emailMode !== "limited" } };
  let websites;
  let siteLimit;
  let nextSite = 0;
  const analysisWrites = [];
  const permits = new Map();
  const statsCache = new Map();
  const cleared = new Set();
  return createServer(async (request, response) => {
    const reply = (status, value) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(value)); };
    try {
      const url = new URL(request.url, "http://localhost");
      const path = url.pathname;
      if (analysisMode !== "disabled" && ["/api/analysis-permit", "/api/run-analysis", "/api/pages/reset"].includes(path)) {
        if (request.method !== "POST") return reply(503, { error: "fixture method disabled" });
        const body = await readBody(request);
        const site = path === "/api/run-analysis" ? body.site_key : url.searchParams.get("site_key");
        if (!websites?.some(value => value.key === site)) return reply(403, { error: "website not available" });
        if (deletion.state !== "none") return reply(410, { error: "Account deletion has been requested." });
        analysisWrites.push({ path, site, ...body });
        if (analysisMode === "retry" && analysisWrites.length === 1) return reply(503, { error: "fixture analysis unavailable" });
        if (path === "/api/analysis-permit") {
          if (analysisMode === "limit") return reply(429, { error: "No refreshes left for this site today." });
          if (!["page", "all"].includes(body.scope) || !Number.isInteger(body.page_count) || body.page_count < 1 || body.page_count > 1000) return reply(400, { error: "invalid refresh request" });
          const token = `fixture-${analysisWrites.length}`;
          permits.set(token, { site, remaining: body.page_count });
          return reply(200, { permit_token: token, scope: body.scope, remaining_free_today: 2 });
        }
        if (typeof body.page !== "string" || !body.page.trim()) return reply(400, { error: "page required" });
        const key = `${site}:${body.page}`;
        if (path === "/api/pages/reset") {
          const previous = statsCache.get(key);
          cleared.add(key);
          statsCache.set(key, { ...previous, total_sessions: 0, analysable_sessions: 0, site_analysable_sessions: 0, desktop_sessions: 0, mobile_sessions: 0, last_analysis: null, click_summary: [], site_key: site, plan: "pro" });
          return reply(200, { deleted_sessions: previous?.total_sessions || 0 });
        }
        const permit = permits.get(body.permit_token);
        if (!permit || permit.site !== site || permit.remaining < 1) return reply(403, { error: "invalid analysis permit" });
        permit.remaining--;
        const previous = statsCache.get(key);
        const result = previous?.last_analysis ? { ...previous.last_analysis, ran_at: new Date().toISOString() } : { site_key: site, page: body.page, ran_at: new Date().toISOString(), session_count: 0, k: 0, clusters: [], failure: { have: 0, needed: 16, message: "Not enough fixture visits to form groups yet." } };
        if (previous) statsCache.set(key, { ...previous, last_analysis: result });
        return reply(200, { ok: true, result });
      }
      if (analysisMode !== "disabled" && request.method === "GET" && path === "/api/stats") {
        if (!websites?.some(value => value.key === url.searchParams.get("site_key"))) return reply(403, { error: "website not available" });
        if (deletion.state !== "none") return reply(410, { error: "Account deletion has been requested." });
        const cached = statsCache.get(`${url.searchParams.get("site_key")}:${url.searchParams.get("page")}`);
        if (cached) return reply(200, cached);
      }
      if (request.method === "GET" && cleared.has(`${url.searchParams.get("site_key")}:${url.searchParams.get("page")}`)) {
        if (deletion.state !== "none") return reply(410, { error: "Account deletion has been requested." });
        if (!websites?.some(value => value.key === url.searchParams.get("site_key"))) return reply(403, { error: "website not available" });
        if (path === "/api/sessions/timeseries") return reply(200, { series: [], total_sessions: 0, engaged_sessions: 0, engagement_rate: 0 });
        if (path === "/api/goal-rates") return reply(200, { goals: [] });
      }
      if (request.method === "GET" && path === "/api/pages/members" && memberMode !== "normal") {
        const key = url.searchParams.get("site_key");
        if (!websites?.some(site => site.key === key)) return reply(403, { error: "website not available" });
        memberReads.push(Object.fromEntries(url.searchParams));
        if (memberMode === "retry" && memberReads.length === 1) return reply(503, { error: "fixture group unavailable" });
        const limited = memberMode === "limited";
        const query = limited ? "" : (url.searchParams.get("q") || "").toLowerCase();
        const offset = limited ? 0 : Math.max(0, Number(url.searchParams.get("offset")) || 0);
        const limit = limited ? 10 : Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 25));
        if (memberMode === "shrink" && offset >= 50) memberShrunk = true;
        const count = memberMode === "empty" ? 0 : memberShrunk ? 26 : 58;
        const days = Number(url.searchParams.get("days")) || 90;
        const rows = Array.from({ length: count }, (_, index) => ({ path: `/products/pack-${String(index + 1).padStart(2, "0")}`, sessions: (100 - index) * days, desktop: (60 - index) * days, mobile: 40 * days, clicks: (index + 1) * days, last_day: "2026-10-18" })).filter(row => row.path.includes(query));
        rows.sort((a, b) => url.searchParams.get("sort") === "clicks" ? b.clicks - a.clicks : b.sessions - a.sessions);
        return reply(200, { total: rows.length, rows: rows.slice(offset, offset + limit), limited });
      }
      if (request.method === "GET" && path === "/api/pages" && ["empty-pages", "pages-error"].includes(pickerMode)) {
        if (!websites?.some(site => site.key === url.searchParams.get("site_key"))) return reply(403, { error: "website not available" });
        if (pickerMode === "empty-pages") return reply(200, []);
        // Home reads the inventory before the goal picker opens.
        if (++pickerPageReads === 2) return reply(503, { error: "fixture picker pages unavailable" });
      }
      if (path.startsWith("/api/") && !["/api/config", "/api/account-deletion"].includes(path) && deletion.state !== "none") return reply(410, { error: "Account deletion has been requested.", account_deleting: true });
      const pathId = /^\/api\/paths\/([^/]+)$/.exec(path)?.[1];
      if (path === "/api/paths" || pathId) {
        const key = url.searchParams.get("site_key");
        if (!websites?.some(site => site.key === key)) return reply(403, { error: "website not available" });
        if (pathMode === "limited") return reply(403, { error: "funnels are part of Ultra", limit_reached: "plan" });
        const pages = ["https://example.com/products/:product", "https://example.com/cart", "https://example.com/checkout"];
        if (!pathLists.has(key)) pathLists.set(key, pathMode === "empty" ? [] : [{ id: `fixture-path-${key}`, name: "Buying a pack", steps: pages }]);
        const list = pathLists.get(key);
        if (request.method === "GET" && path === "/api/paths") {
          pathReads.push({ site: key, days: url.searchParams.get("days") });
          if (pathMode === "read-error" && pathReads.filter(value => value.site === key).length === 1) return reply(503, { error: "fixture paths unavailable" });
          const days = [7, 30, 90].includes(Number(url.searchParams.get("days"))) ? Number(url.searchParams.get("days")) : 30;
          return reply(200, { cap: pathMode === "full" ? 1 : 10, paths: list.map(value => ({ ...value, days, steps: value.steps.map((page, index) => {
            const count = pathMode === "zero" ? 0 : Math.max(0, (100 - index * 35)) * (days === 7 ? 1 : days === 30 ? 3 : 6);
            return { page, all: count, desktop: Math.round(count * 0.6), mobile: count - Math.round(count * 0.6) };
          }) })) });
        }
        if (request.method === "POST" && path === "/api/paths") {
          if (list.length >= (pathMode === "full" ? 1 : 10)) return reply(400, { error: "remove a path first" });
          const body = await readBody(request);
          if (typeof body.name !== "string" || !body.name.trim() || !Array.isArray(body.steps) || body.steps.length < 2 || body.steps.length > 6 || body.steps.some(value => typeof value !== "string" || !/^https?:\/\//.test(value)) || new Set(body.steps).size !== body.steps.length) return reply(400, { error: "choose a name and 2 to 6 different pages" });
          pathWrites.push({ method: "POST", site: key, ...body });
          const attemptKey = `path:${key}:${body.name}`;
          if (body.name.startsWith("Fixture retry") && !attempts.has(attemptKey)) { attempts.set(attemptKey, 1); return reply(503, { error: "fixture path save unavailable" }); }
          const added = { id: `fixture-path-${pathWrites.length}`, name: body.name.trim().slice(0, 60), steps: [...body.steps] };
          list.push(added);
          setTimeout(() => reply(201, { id: added.id }), 700);
          return;
        }
        if (request.method === "DELETE" && pathId) {
          const index = list.findIndex(value => value.id === decodeURIComponent(pathId));
          if (index < 0) return reply(404, { error: "that path isn't there" });
          pathWrites.push({ method: "DELETE", site: key, id: decodeURIComponent(pathId) });
          if (pathMode === "remove-error" && !attempts.has(`remove:${pathId}`)) { attempts.set(`remove:${pathId}`, 1); return reply(503, { error: "fixture path removal unavailable" }); }
          list.splice(index, 1);
          return reply(200, { deleted: true });
        }
        return reply(503, { error: "fixture method disabled" });
      }
      if (path === "/api/pages" && ["empty-pages", "pages-error"].includes(pathMode)) {
        const attemptKey = `path-pages:${url.searchParams.get("site_key")}`;
        if (pathMode === "pages-error" && !attempts.has(attemptKey)) { attempts.set(attemptKey, 1); return reply(503, { error: "fixture pages unavailable" }); }
        if (pathMode === "empty-pages") return reply(200, []);
      }
      const changeId = /^\/api\/page-changes\/([^/]+)$/.exec(path)?.[1];
      if (path === "/api/page-changes" || changeId || path === "/api/compare" || path === "/api/change-finding") {
        const key = url.searchParams.get("site_key");
        if (!websites?.some(site => site.key === key)) return reply(403, { error: "website not available" });
        if (comparisonMode === "limited") return reply(403, { error: "before-and-after comparisons need a plan", limit_reached: "plan" });
        if (changeId && request.method === "DELETE") {
          const entry = [...changeLists].find(([entryKey, values]) => entryKey.startsWith(`${key}|`) && values.some(value => value.id === decodeURIComponent(changeId)));
          if (!entry) return reply(404, { error: "that change isn't there" });
          changeLists.set(entry[0], entry[1].filter(value => value.id !== decodeURIComponent(changeId)));
          changeWrites.push({ method: "DELETE", site: key, id: decodeURIComponent(changeId) });
          return reply(200, { deleted: true });
        }
        const body = request.method === "POST" ? await readBody(request) : {};
        const page = body.page || url.searchParams.get("page");
        if (!page) return reply(400, { error: "pick a page first" });
        const listKey = `${key}|${page}`;
        const sourceFinding = reference => {
          const analysis = statsCache.get(`${key}:${page}`)?.last_analysis;
          return analysis && new Date(analysis.ran_at).toISOString() === reference?.ran_at ? findingSnapshot(analysis, reference) : null;
        };
        if (path === "/api/change-finding" && request.method === "GET") {
          const finding = sourceFinding(Object.fromEntries(url.searchParams));
          return finding ? reply(200, finding) : reply(400, { error: "That finding isn't available. Reopen it from the page's analysis." });
        }
        const dayAgo = days => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
        if (!changeLists.has(listKey)) changeLists.set(listKey, comparisonMode === "empty" ? [] : [{ id: `fixture-change-${changeLists.size + 1}-latest`, day: dayAgo(3), note: "New product photos" }, { id: `fixture-change-${changeLists.size + 1}-older`, day: dayAgo(10), note: "Clearer checkout" }]);
        const list = changeLists.get(listKey);
        if (path === "/api/page-changes" && request.method === "GET") return reply(200, [...list].sort((a, b) => b.day.localeCompare(a.day)));
        if (path === "/api/page-changes" && request.method === "POST") {
          const day = body.day;
          if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(`${day}T00:00:00Z`)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day || day > dayAgo(0)) return reply(400, { error: "pick a valid past date" });
          const finding = body.source ? sourceFinding(body.source) : null;
          if (body.source && (!finding || !String(body.note || "").trim() || day < finding.ran_at.slice(0, 10))) return reply(400, { error: "Reopen the finding and describe the completed change." });
          changeWrites.push({ method: "POST", site: key, page, day, note: body.note });
          if (String(body.note).startsWith("Fixture retry") && !attempts.has(`change:${body.note}`)) { attempts.set(`change:${body.note}`, 1); return reply(503, { error: "fixture change save unavailable" }); }
          const change = { id: `fixture-change-${changeWrites.length}`, day, note: String(body.note || "").trim().slice(0, 120), finding };
          list.push(change);
          setTimeout(() => reply(201, change), 500);
          return;
        }
        if (path === "/api/compare" && request.method === "GET") {
          const change = url.searchParams.get("change") ? list.find(value => value.id === url.searchParams.get("change")) : null;
          if (url.searchParams.has("change") && !change) return reply(404, { error: "that change isn't there" });
          const day = change?.day || url.searchParams.get("day");
          const attemptKey = `compare:${key}:${page}:${day}`;
          if (comparisonMode === "retry" && !attempts.has(attemptKey)) { attempts.set(attemptKey, 1); return reply(503, { error: "fixture comparison unavailable" }); }
          const days = Math.min(14, Math.floor((Date.now() - Date.parse(`${day}T00:00:00Z`)) / 86400000) - 1);
          if (!Number.isFinite(days)) return reply(400, { error: "pick a day" });
          if (days < 1) return reply(200, { ready: false, days: 0 });
          const sparse = comparisonMode === "sparse";
          return reply(200, { ready: true, days, device: change?.finding?.device || null, provisional: days < 14, goal_status: "ready",
            before: { visits: sparse ? 2 : 300, visitsPerDay: sparse ? 0.5 : 100, engaged: sparse ? null : 0.4, timeOnPage: sparse ? null : 45000, actionsPerVisit: sparse ? null : 1.2, scrollDepth: sparse ? null : 0.5, phoneShare: sparse ? null : 0.25 },
            after: { visits: sparse ? 0 : 450, visitsPerDay: sparse ? 0 : 150, engaged: sparse ? null : 0.65, timeOnPage: sparse ? null : 50000, actionsPerVisit: sparse ? null : 1.5, scrollDepth: sparse ? null : 0.6, phoneShare: sparse ? null : 0.55 },
            goal: { id: "fixture-goal", name: "Added to cart", before: sparse ? 0 : 0.1, after: sparse ? null : 113 / 450, reached: sparse ? 0 : 143, before_reached: sparse ? 0 : 30, after_reached: sparse ? 0 : 113, provisional: days < 14, verdict: sparse || days < 14 ? "unclear" : "better" },
            groups: sparse ? null : { before: [{ group: "Explorers", share: 0.6 }], after: [{ group: "Explorers", share: 0.4 }, { group: "Deciders", share: 0.6 }] }
          });
        }
        return reply(503, { error: "fixture method disabled" });
      }
      if (path === "/api/account-deletion") {
        if (request.method === "GET") return reply(200, deletion);
        if (request.method !== "POST") return reply(503, { error: "fixture method disabled" });
        const body = await readBody(request);
        if (body.confirmation !== "DELETE") return reply(400, { error: "Type DELETE to confirm permanent account deletion." });
        deletionAttempts++;
        if (deletionMode === "retry" && deletionAttempts === 1) return reply(503, { error: "fixture deletion unavailable" });
        deletion = { state: deletionMode === "retrying" ? "retrying" : "pending", requested_at: new Date().toISOString() };
        return reply(202, deletion);
      }
      if (request.method === "GET" && path === "/__fixtures") return reply(200, { questions, reports, websiteChanges, sites: websites, goalChanges, goalLists: Object.fromEntries(goalLists), changeWrites, changeLists: Object.fromEntries(changeLists), pathWrites, pathReads, pathLists: Object.fromEntries(pathLists), pageLists: Object.fromEntries(pageLists), memberReads, formReads, emailChanges, emailPrefs, emailReads, analysisWrites });
      if (path === "/api/email-prefs") {
        if (request.method === "GET") {
          emailReads++;
          if (emailMode === "read-error" && emailReads === 1) return reply(503, { error: "fixture preferences unavailable" });
          return reply(200, emailPrefs);
        }
        if (request.method === "PATCH") {
          const body = await readBody(request);
          const changes = Object.entries(body).filter(([key, value]) => ["weekly_summary", "shift_alerts"].includes(key) && typeof value === "boolean");
          if (!changes.length) return reply(400, { error: "nothing to change" });
          if (changes.some(([key]) => !emailPrefs.available[key])) return reply(403, { error: "email not available" });
          emailChanges.push(Object.fromEntries(changes));
          if (emailMode === "retry" && emailChanges.length === 1) return reply(503, { error: "fixture preference save unavailable" });
          setTimeout(() => { Object.assign(emailPrefs, Object.fromEntries(changes)); reply(200, { updated: changes.length }); }, 800);
          return;
        }
        return reply(503, { error: "fixture method disabled" });
      }
      const goalId = /^\/api\/goals\/([^/]+)$/.exec(path)?.[1];
      const siteKey = url.searchParams.get("site_key");
      if (path === "/api/goals" || goalId || path === "/api/main-goal" || path === "/api/forms") {
        if (!websites) return reply(409, { error: "load the fixture account first" });
        if (!websites.some(site => site.key === siteKey)) return reply(403, { error: "website not available" });
        const list = goalLists.get(siteKey);
        if (request.method === "GET" && path === "/api/forms") {
          formReads++;
          if (pickerMode === "empty-forms") return reply(200, []);
          if (pickerMode === "forms-error" && formReads === 1) return reply(503, { error: "fixture forms unavailable" });
          const forms = [{ id: "fixture-newsletter", name: "newsletter", action: "/subscribe", sent: 12, page: "https://example.com/" }, { id: "fixture-contact", name: "contact", action: "/contact", sent: 5, page: "https://example.com/contact" }];
          return reply(200, pickerMode === "reordered-forms" && formReads > 1 ? forms.reverse() : forms);
        }
        if (request.method === "GET" && path === "/api/goals" && list) return reply(200, list);
        if (request.method !== "GET") {
          if (!list) return reply(409, { error: "load the fixture goals first" });
          if (!((path === "/api/goals" && request.method === "POST") || (goalId && ["PATCH", "DELETE"].includes(request.method)) || (path === "/api/main-goal" && request.method === "PUT"))) return reply(503, { error: "fixture method disabled" });
          const body = request.method === "DELETE" ? {} : await readBody(request);
          goalChanges.push({ method: request.method, path, site: siteKey, ...body });
          if (path === "/api/main-goal") {
            if (!body.page) return reply(400, { error: "pick a page first" });
            if (body.goal && !list.goals.some(goal => goal.id === body.goal)) return reply(404, { error: "that goal isn't there" });
            list.main_goals = list.main_goals.filter(value => value.page !== body.page);
            if (body.goal) list.main_goals.push({ page: body.page, goal: body.goal });
            return reply(200, { page: body.page, goal: body.goal || null });
          }
          const existing = goalId && list.goals.find(goal => goal.id === decodeURIComponent(goalId));
          if (goalId && !existing) return reply(404, { error: "that goal isn't there" });
          if (request.method === "DELETE") {
            list.goals = list.goals.filter(goal => goal.id !== existing.id);
            list.main_goals = list.main_goals.filter(value => value.goal !== existing.id);
            return reply(200, { deleted: true });
          }
          if (!existing && list.goals.length >= list.cap) return reply(400, { error: "goal limit reached", limit_reached: "goals" });
          const parsed = parseGoal(body, existing || null);
          if (parsed.error) return reply(400, { error: parsed.error });
          if (!existing && parsed.goal.type === "form" && !list.form_goals) return reply(403, { error: "form goals are part of Ultra", limit_reached: "plan" });
          const attemptKey = `goal:${siteKey}:${goalId}:${parsed.goal.name}`;
          const attempt = (attempts.get(attemptKey) || 0) + 1;
          attempts.set(attemptKey, attempt);
          if (parsed.goal.name.startsWith("Fixture retry") && attempt === 1) return reply(503, { error: "fixture goal unavailable" });
          const goal = { ...existing, ...parsed.goal, backfill: existing?.backfill || "queued" };
          list.goals = existing ? list.goals.map(value => value.id === goal.id ? goal : value) : [...list.goals, goal];
          if (!existing) setTimeout(() => { const current = list.goals.find(value => value.id === goal.id); if (current) current.backfill = current.name === "Fixture backfill failed" ? "failed" : "done"; }, 1500);
          setTimeout(() => reply(existing ? 200 : 201, goal), 500);
          return;
        }
      }
      if (request.method === "GET" && path === "/api/goal-rates" && goalLists.has(siteKey)) {
        const list = goalLists.get(siteKey), page = url.searchParams.get("page");
        const main = list.main_goals.find(value => value.page === page)?.goal;
        const goals = list.goals.filter(goal => (!goal.pages?.length || goal.pages.includes(page)) && !(goal.type === "page" && goal.match.page === page))
          .map(goal => {
            const reached = goal.reached_last_7_days || 0, visits = Math.max(100, reached);
            return { ...goal, main: goal.id === main, visits, reached, rate: reached / visits };
          });
        return reply(200, { page, days: 30, goals: goals.sort((a, b) => Number(b.main) - Number(a.main)) });
      }
      const websiteKey = /^\/api\/sites\/([^/]+)$/.exec(path)?.[1];
      if ((path === "/api/sites" && request.method === "POST") || (websiteKey && ["PATCH", "DELETE"].includes(request.method))) {
        if (!websites) return reply(409, { error: "load the fixture account first" });
        const key = websiteKey && decodeURIComponent(websiteKey);
        const existing = websites.find(site => site.key === key);
        if (key && !existing) return reply(404, { error: "website not found" });
        const body = request.method === "DELETE" ? {} : await readBody(request);
        websiteChanges.push({ method: request.method, key, ...body });
        const name = String(body.name || "").trim().slice(0, 80);
        if (request.method !== "DELETE" && !name) return reply(400, { error: "name required" });
        const attemptKey = `website:${key}:${name}`;
        const attempt = (attempts.get(attemptKey) || 0) + 1;
        attempts.set(attemptKey, attempt);
        if (name.startsWith("Fixture retry") && attempt === 1) return reply(503, { error: "fixture website unavailable" });
        if (request.method === "POST" && websites.length >= siteLimit) return reply(400, { error: "website limit reached" });
        let site;
        let reset = false;
        if (request.method === "DELETE") {
          websites = websites.filter(value => value.key !== key);
          reset = websites.length === 0;
          if (reset) websites.push({ key: `tt_fixture_${++nextSite}`, name: "My website", url: null, domain: null });
        } else if (existing) { existing.name = name; site = existing; }
        else { site = { key: `tt_fixture_${++nextSite}`, name, url: body.url || null, domain: null }; websites.push(site); }
        setTimeout(() => reply(request.method === "POST" ? 201 : 200, { sites: websites, limit: siteLimit, ...(site ? { site } : { deleted: true, reset, deleted_sessions: 0, deleted_analyses: 0, deleted_reports: 0 }) }), 500);
        return;
      }
      if (request.method === "GET" && path === "/api/sites" && websites) return reply(200, { sites: websites, limit: siteLimit });
      if (request.method === "GET" && path === "/api/pages" && url.searchParams.get("site_key")?.startsWith("tt_fixture_")) return reply(200, []);
      // Model requests and support alerts stop before the upstream allowlist.
      if (request.method === "POST" && path === "/api/ask") {
        const body = await readBody(request);
        const site = url.searchParams.get("site_key") || body.site_key;
        questions.push({ site, question: body.question, history: body.history });
        const key = `${site}:${body.question}`;
        const attempt = (attempts.get(key) || 0) + 1;
        attempts.set(key, attempt);
        if (body.question === "Fixture limit") return reply(403, { error: "upgrade for more", limit_reached: "ask" });
        if (body.question === "Fixture retry" && attempt === 1) return reply(503, { error: "fixture service unavailable" });
        const delay = body.question === "Fixture delayed" ? 5000 : 150;
        setTimeout(() => reply(200, {
          answer: `## Your visitors\n\n**Home** leads with 120 visits.\n- Phone visitors scroll further.\n- Check the main goal.\n\nLiteral text: <script>alert(1)</script>.`,
          lookups: ["list_pages", "get_goals", "list_pages"]
        }), delay);
        return;
      }
      if (request.method === "POST" && path === "/api/bug-reports") {
        const body = await readBody(request);
        const site = url.searchParams.get("site_key") || body.site_key;
        reports.push({ ...body, site });
        const key = `report:${site}:${body.description}`;
        const attempt = (attempts.get(key) || 0) + 1;
        attempts.set(key, attempt);
        if (String(body.description).startsWith("Fixture retry") && attempt === 1) return reply(503, { error: "fixture report unavailable" });
        setTimeout(() => reply(201, { id: "fixture-report", created_at: new Date().toISOString() }), 1000);
        return;
      }
      if (!(request.method === "GET" && READS.has(path)) && !(request.method === "POST" && path === "/api/account")) {
        return reply(503, { error: "this request is disabled by the fixture API" });
      }
      const headers = {};
      if (request.headers.authorization) headers.Authorization = request.headers.authorization;
      const upstream = await upstreamFetch(`http://127.0.0.1:5000${request.url}`, {
        method: request.method, headers,
        ...(request.method === "POST" ? { body: "{}" } : {})
      });
      if (request.method === "GET" && path === "/api/stats" && upstream.ok) {
        const stats = await upstream.json();
        statsCache.set(`${siteKey}:${url.searchParams.get("page")}`, stats);
        return reply(200, stats);
      }
      if (path === "/api/config" && configDelayMs) await new Promise(resolve => setTimeout(resolve, configDelayMs));
      if (request.method === "GET" && path === "/api/pages" && upstream.ok) {
        const pages = (await upstream.json()).filter(value => !cleared.has(`${siteKey}:${value.page}`));
        pageLists.set(siteKey, pages);
        return reply(200, pages);
      }
      if (request.method === "GET" && path === "/api/goals" && upstream.ok) {
        const list = await upstream.json();
        list.cap = list.goals.length + 2;
        if (pickerMode === "limited") list.form_goals = false;
        goalLists.set(siteKey, list);
        return reply(200, list);
      }
      if (request.method === "POST" && path === "/api/account" && upstream.ok) {
        const account = await upstream.json();
        websites ??= account.sites;
        siteLimit ??= websites.length + 1;
        return reply(200, { ...account, sites: websites, site_limit: siteLimit });
      }
      response.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") || "application/json" });
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) { reply(error instanceof RangeError ? 413 : 502, { error: "could not load local fixture data" }); }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const configDelayMs = Math.min(30_000, Math.max(0, Number(process.env.FIXTURE_CONFIG_DELAY_MS) || 0));
  createFixtureApi(fetch, { configDelayMs, emailMode: process.env.FIXTURE_EMAIL_MODE, deletionMode: process.env.FIXTURE_DELETION_MODE, comparisonMode: process.env.FIXTURE_COMPARISON_MODE, pathMode: process.env.FIXTURE_PATH_MODE, pickerMode: process.env.FIXTURE_PICKER_MODE, memberMode: process.env.FIXTURE_MEMBER_MODE, analysisMode: process.env.FIXTURE_ANALYSIS_MODE }).listen(5001, "127.0.0.1", () => console.log("Fixture API on 127.0.0.1:5001; dashboard writes are mocked and other writes are blocked."));
}
