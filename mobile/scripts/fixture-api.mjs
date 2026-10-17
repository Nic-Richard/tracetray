import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const READS = new Set(["/api/config", "/api/pages", "/api/sites", "/api/stats", "/api/sessions/timeseries", "/api/goal-rates", "/api/pages/members"]);

export function createFixtureApi(upstreamFetch = fetch) {
  const questions = [];
  const attempts = new Map();
  return createServer(async (request, response) => {
    const reply = (status, value) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(value)); };
    try {
      const url = new URL(request.url, "http://localhost");
      const path = url.pathname;
      if (request.method === "GET" && path === "/__fixtures") return reply(200, { questions });
      // Model requests always stop here, before the read-only upstream allowlist.
      if (request.method === "POST" && path === "/api/ask") {
        let raw = "";
        for await (const chunk of request) {
          raw += chunk;
          if (raw.length > 32_000) return reply(413, { error: "fixture request too large" });
        }
        const body = JSON.parse(raw);
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
      if (!(request.method === "GET" && READS.has(path)) && !(request.method === "POST" && path === "/api/account")) {
        return reply(503, { error: "this request is disabled by the fixture API" });
      }
      const headers = {};
      if (request.headers.authorization) headers.Authorization = request.headers.authorization;
      const upstream = await upstreamFetch(`http://127.0.0.1:5000${request.url}`, {
        method: request.method, headers,
        ...(request.method === "POST" ? { body: "{}" } : {})
      });
      response.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") || "application/json" });
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch { reply(502, { error: "could not load local fixture data" }); }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createFixtureApi().listen(5001, "127.0.0.1", () => console.log("Fixture API on 127.0.0.1:5001; Ask is mocked and other writes are blocked."));
}
