import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const READS = new Set(["/api/config", "/api/pages", "/api/sites", "/api/stats", "/api/sessions/timeseries", "/api/goal-rates", "/api/pages/members", "/api/usage"]);

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

export function createFixtureApi(upstreamFetch = fetch) {
  const questions = [];
  const reports = [];
  const attempts = new Map();
  const websiteChanges = [];
  let websites;
  let siteLimit;
  let nextSite = 0;
  return createServer(async (request, response) => {
    const reply = (status, value) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(value)); };
    try {
      const url = new URL(request.url, "http://localhost");
      const path = url.pathname;
      if (request.method === "GET" && path === "/__fixtures") return reply(200, { questions, reports, websiteChanges, sites: websites });
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
  createFixtureApi().listen(5001, "127.0.0.1", () => console.log("Fixture API on 127.0.0.1:5001; Ask/reports/websites are mocked and other writes are blocked."));
}
