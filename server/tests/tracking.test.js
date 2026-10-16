const assert = require("node:assert/strict");
const { test } = require("node:test");
const { visitTime, cleanSummary, cleanReferrer, isBot } = require("../src/lib/tracking");
const { groupPage } = require("../src/lib/pageGroups");

test("what a browser sends is checked before it's stored", () => {
    const now = Date.UTC(2026, 9, 15, 12);
    assert.equal(visitTime(now - 60000, now), now - 60000);
    assert.equal(visitTime(now + 400 * 864e5, now), now);
    assert.equal(visitTime("yesterday", now), now);
    assert.equal(visitTime({ $gt: 0 }, now), now);
    assert.equal(visitTime(now - 3 * 864e5, now), now);
    const summary = cleanSummary({ duration_ms: 5000, clicks: "3", junk: "y".repeat(1000), taps: -4 });
    assert.deepEqual(Object.keys(summary).includes("junk"), false);
    assert.equal(summary.duration_ms, 5000);
    assert.equal(summary.clicks, 3);
    assert.equal(summary.taps, 0);
    assert.equal(cleanSummary("nope"), undefined);
});

test("no query string is stored, from pages, hash routes or referrers", () => {
    assert.equal(cleanReferrer("https://search.example/?q=jane&email=jane@example.com"), "https://search.example/");
    assert.equal(cleanReferrer("https://app.example/#/route?token=abc"), "https://app.example/#/route");
    assert.equal(cleanReferrer("javascript:alert(1)"), null);
    assert.equal(cleanReferrer({}), null);
    assert.equal(groupPage("https://shop.example/app/#/weather?email=jane@example.com").page, "https://shop.example/app/#/weather");
    assert.equal(groupPage("https://shop.example/p?email=jane@example.com").page, "https://shop.example/p");
});

test("page pictures only go to public addresses", async () => {
    const { privateAddress, publicUrl } = require("../src/lib/pageShots");
    for (const ip of ["127.0.0.1", "10.2.3.4", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:10.0.0.1"]) assert.equal(privateAddress(ip), true, ip);
    for (const ip of ["8.8.8.8", "172.32.0.1", "2606:4700::1111"]) assert.equal(privateAddress(ip), false, ip);
    assert.equal(await publicUrl("file:///etc/passwd"), false);
    assert.equal(await publicUrl("http://localhost:5000/"), false);
});

test("bots and headless browsers are told apart from real visitors", () => {
    for (const agent of [
        "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0)",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36",
        "facebookexternalhit/1.1", "curl/8.4.0", ""
    ]) assert.equal(isBot(agent), true, agent);
    for (const agent of [
        "Mozilla/5.0 (Linux; Android 13; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ]) assert.equal(isBot(agent), false, agent);
});
