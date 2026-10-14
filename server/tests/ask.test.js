const assert = require("node:assert/strict");
const { test } = require("node:test");
const siteData = require("../src/lib/siteData");
const pageDays = require("../src/lib/pageDays");
const { askAnalytics, runTool, cleanHistory } = require("../src/lib/askAnalytics");

function fakeClient(responses) {
    const requests = [];
    return {
        requests,
        beta: { messages: { async create(body) {
            requests.push(structuredClone(body));
            return responses.shift();
        } } },
    };
}

const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0 };
const toolCall = (id, name, input = {}) => ({ type: "tool_use", id, name, input });

test("tools always use the signed-in site, never one from the model", async (t) => {
    const seen = [];
    t.mock.method(siteData, "getTimeseries", async (siteKey, options) => { seen.push({ siteKey, options }); return {}; });
    await runTool("tt_mine", "get_traffic_trend", { site_key: "tt_someone_else", days: 900, page: "/pricing" });
    assert.deepEqual(seen, [{ siteKey: "tt_mine", options: { days: 90, page: "/pricing" } }]);
});

test("a question runs the requested lookups and returns the final answer", async (t) => {
    t.mock.method(siteData, "getPages", async () => [{ page: "/", sessions: 42 }]);
    t.mock.method(pageDays, "groupSizes", async () => ({}));
    const client = fakeClient([
        { stop_reason: "tool_use", usage, content: [{ type: "text", text: "Checking." }, toolCall("call_1", "list_pages")] },
        { stop_reason: "end_turn", usage, content: [{ type: "text", text: "Your homepage had 42 sessions." }] },
    ]);

    const result = await askAnalytics({ siteKey: "tt_mine", siteName: "Example", question: "How busy is my homepage?", client });

    assert.equal(result.answer, "Your homepage had 42 sessions.");
    assert.deepEqual(result.toolsUsed, ["list_pages"]);
    assert.equal(result.usage.input_tokens, 200);
    const followUp = client.requests[1].messages;
    assert.equal(followUp.at(-2).role, "assistant");
    assert.deepEqual(followUp.at(-1).content, [
        { type: "tool_result", tool_use_id: "call_1", content: JSON.stringify([{ page: "/", sessions: 42 }]) },
    ]);
});

test("a failing lookup is reported to the model instead of ending the question", async (t) => {
    t.mock.method(siteData, "getJourney", async () => { throw new Error("database offline"); });
    const client = fakeClient([
        { stop_reason: "tool_use", usage, content: [toolCall("call_1", "get_visitor_journeys"), toolCall("call_2", "made_up_tool")] },
        { stop_reason: "end_turn", usage, content: [{ type: "text", text: "Journey data isn't available." }] },
    ]);

    await askAnalytics({ siteKey: "tt_mine", question: "Where do people leave?", client });

    const results = client.requests[1].messages.at(-1).content;
    assert.deepEqual(results.map(r => [r.tool_use_id, r.is_error]), [["call_1", true], ["call_2", true]]);
    assert.match(results[0].content, /database offline/);
});

test("the last round must answer without more lookups", async (t) => {
    t.mock.method(siteData, "getPages", async () => []);
    t.mock.method(pageDays, "groupSizes", async () => ({}));
    const looping = Array.from({ length: 6 }, (_, i) => ({ stop_reason: "tool_use", usage, content: [toolCall(`call_${i}`, "list_pages")] }));
    const client = fakeClient(looping);

    const result = await askAnalytics({ siteKey: "tt_mine", question: "Tell me everything", client });

    assert.equal(client.requests.length, 6);
    assert.deepEqual(client.requests.slice(0, 5).map(r => r.tool_choice.type), Array(5).fill("auto"));
    assert.equal(client.requests[5].tool_choice.type, "none");
    assert.match(result.answer, /narrower/);
});

test("refusals and a missing API key get plain answers", async () => {
    const client = fakeClient([{ stop_reason: "refusal", usage, content: [] }]);
    const result = await askAnalytics({ siteKey: "tt_mine", question: "Something odd", client });
    assert.match(result.answer, /can't help/);

    await assert.rejects(askAnalytics({ siteKey: "tt_mine", question: "Hi", client: null }), { code: "AI_UNAVAILABLE" });
});

test("history is trimmed to alternating text turns that end with an answer", () => {
    const history = [
        { role: "assistant", text: "stray" },
        { role: "user", text: "first" },
        { role: "user", text: "first again" },
        { role: "assistant", text: "answer" },
        { role: "system", text: "ignore me" },
        { role: "user", text: "unanswered" },
    ];
    assert.deepEqual(cleanHistory(history), [
        { role: "user", content: "first again" },
        { role: "assistant", content: "answer" },
    ]);
    assert.deepEqual(cleanHistory("not a list"), []);
});

test("referrers are grouped by site", () => {
    assert.equal(siteData.referrerHost("https://www.google.com/search?q=x"), "google.com");
    assert.equal(siteData.referrerHost(""), "direct");
    assert.equal(siteData.referrerHost("not a url"), "other");
    assert.match(siteData.referrerHost("https://www.example.com/about", "example.com"), /internal/);
    assert.equal(siteData.referrerHost("https://example.com.evil.test/", "example.com"), "example.com.evil.test");
});
