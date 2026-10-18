import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const { parseGoal } = createRequire(import.meta.url)("../../server/src/lib/goals.js");

const READS = new Set(["/api/config", "/api/pages", "/api/sites", "/api/stats", "/api/sessions/timeseries", "/api/goal-rates", "/api/goals", "/api/pages/members", "/api/usage"]);

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

export function createFixtureApi(upstreamFetch = fetch, { configDelayMs = 0, emailMode = "normal" } = {}) {
  const questions = [];
  const reports = [];
  const attempts = new Map();
  const websiteChanges = [];
  const goalChanges = [];
  const goalLists = new Map();
  const emailChanges = [];
  let emailReads = 0;
  const emailPrefs = { weekly_summary: false, shift_alerts: false, available: { weekly_summary: true, shift_alerts: emailMode !== "limited" } };
  let websites;
  let siteLimit;
  let nextSite = 0;
  return createServer(async (request, response) => {
    const reply = (status, value) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(value)); };
    try {
      const url = new URL(request.url, "http://localhost");
      const path = url.pathname;
      if (request.method === "GET" && path === "/__fixtures") return reply(200, { questions, reports, websiteChanges, sites: websites, goalChanges, goalLists: Object.fromEntries(goalLists), emailChanges, emailPrefs, emailReads });
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
        if (request.method === "GET" && path === "/api/forms") return reply(200, [{ id: "fixture-newsletter", name: "newsletter", action: "/subscribe", sent: 12, page: "https://example.com/" }]);
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
      if (path === "/api/config" && configDelayMs) await new Promise(resolve => setTimeout(resolve, configDelayMs));
      if (request.method === "GET" && path === "/api/goals" && upstream.ok) {
        const list = await upstream.json();
        list.cap = list.goals.length + 2;
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
  createFixtureApi(fetch, { configDelayMs, emailMode: process.env.FIXTURE_EMAIL_MODE }).listen(5001, "127.0.0.1", () => console.log("Fixture API on 127.0.0.1:5001; Ask/reports/websites/goals/email preferences are mocked and other writes are blocked."));
}
