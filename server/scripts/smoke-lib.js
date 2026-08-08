#!/usr/bin/env node

const assert = require('assert');
const path = require('path');

const dbPath = path.resolve(__dirname, '../src/db/models.js');
const mockClickSessions = [
  { site_key: 'tt_test', page: '/', end_time: '2026-01-01', summary: { mouse_moves: 5 }, events: [{ type: 'click', tag: 'A', text: 'Homepage CTA' }] },
  { site_key: 'tt_test', page: '/dashboard.html', end_time: '2026-01-01', summary: { mouse_moves: 5 }, events: [{ type: 'click', tag: 'BUTTON', text: 'Refresh Analysis' }] },
];
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    Account: {},
    Session: {
      deleteMany: async () => ({ deletedCount: 0 }),
      find: (query) => ({
        lean: async () => mockClickSessions.filter(s => !query.page || s.page === query.page),
      }),
    },
    AnalysisResult: { deleteMany: async () => ({ deletedCount: 0 }) },
    BugReport: { deleteMany: async () => ({ deletedCount: 0 }) },
  },
};

const { normalizeTrackingDomain } = require('../src/lib/tracking');
const { getSiteLimit, getAccountSites, resolveSiteKey } = require('../src/lib/siteAccount');
const { createAnalysisPermit, consumeAnalysisPermit } = require('../src/lib/analysisState');
const { getClickSummary } = require('../src/lib/clickSummary');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test('normalizeTrackingDomain strips www and keeps the root domain', () => {
  assert.strictEqual(normalizeTrackingDomain('https://www.example.com/page'), 'example.com');
  assert.strictEqual(normalizeTrackingDomain('https://shop.example.com'), 'example.com');
});

test('normalizeTrackingDomain keeps the registrable domain on common second-level suffixes', () => {
  assert.strictEqual(normalizeTrackingDomain('https://shop.example.co.uk'), 'example.co.uk');
  assert.strictEqual(normalizeTrackingDomain('https://example.com.au'), 'example.com.au');
});

test('normalizeTrackingDomain keeps localhost and bare IPs as-is', () => {
  assert.strictEqual(normalizeTrackingDomain('http://localhost:8080'), 'localhost');
  assert.strictEqual(normalizeTrackingDomain('http://192.168.1.10:3000'), '192.168.1.10');
});

test('normalizeTrackingDomain rejects non-http protocols and invalid URLs', () => {
  assert.strictEqual(normalizeTrackingDomain('not a url'), null);
  assert.strictEqual(normalizeTrackingDomain('ftp://example.com'), null);
});

test('getSiteLimit gives every account the beta limit while in beta mode', () => {
  const originalMode = process.env.TRACETRAY_MODE;
  process.env.TRACETRAY_MODE = 'beta';
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/lib/siteAccount')];
  const { getSiteLimit: getSiteLimitBeta } = require('../src/lib/siteAccount');

  assert.strictEqual(getSiteLimitBeta({ plan: 'none' }), 5);
  assert.strictEqual(getSiteLimitBeta({ plan: 'pro' }), 5);

  process.env.TRACETRAY_MODE = originalMode;
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/lib/siteAccount')];
});

test('getAccountSites builds a single-site fallback for legacy accounts', () => {
  const account = { site_key: 'tt_legacy', site_url: 'https://legacy.example.com', created_at: new Date('2026-01-01') };
  const sites = getAccountSites(account);

  assert.strictEqual(sites.length, 1);
  assert.strictEqual(sites[0].key, 'tt_legacy');
  assert.strictEqual(sites[0].url, 'https://legacy.example.com');
});

test('getAccountSites returns an empty list for an account with no sites at all', () => {
  assert.deepStrictEqual(getAccountSites({}), []);
});

test('resolveSiteKey picks the requested key only if it belongs to the account', () => {
  const account = { site_key: 'tt_a', sites: [{ key: 'tt_a' }, { key: 'tt_b' }] };

  assert.strictEqual(resolveSiteKey({ query: { site_key: 'tt_b' }, body: {} }, account), 'tt_b');
  assert.strictEqual(resolveSiteKey({ query: {}, body: {} }, account), 'tt_a');
  assert.strictEqual(resolveSiteKey({ query: { site_key: 'tt_not_mine' }, body: {} }, account), null);
});

test('an analysis permit can only be consumed by the user and site it was issued for', () => {
  const token = createAnalysisPermit('user_1', 'tt_site', 'page', 1);

  assert.strictEqual(consumeAnalysisPermit(token, 'user_2', 'tt_site'), false);
  assert.strictEqual(consumeAnalysisPermit(token, 'user_1', 'tt_other_site'), false);
  assert.strictEqual(consumeAnalysisPermit(token, 'user_1', 'tt_site'), true);
});

test('an analysis permit cannot be reused once its remaining count is exhausted', () => {
  const token = createAnalysisPermit('user_1', 'tt_site', 'all', 1);

  assert.strictEqual(consumeAnalysisPermit(token, 'user_1', 'tt_site'), true);
  assert.strictEqual(consumeAnalysisPermit(token, 'user_1', 'tt_site'), false);
});

test('getClickSummary scoped to one page excludes clicks recorded on other pages', async () => {
  const homepageOnly = await getClickSummary('tt_test', '/', 15);
  assert.strictEqual(homepageOnly.length, 1);
  assert.strictEqual(homepageOnly[0].text, 'Homepage CTA');
});

test('getClickSummary with no page (or "all") merges clicks from every page', async () => {
  const allPages = await getClickSummary('tt_test', null, 15);
  const texts = allPages.map(c => c.text).sort();
  assert.deepStrictEqual(texts, ['Homepage CTA', 'Refresh Analysis']);
});

(async () => {
  let passed = 0;

  for (const { name, fn } of tests) {
    try {
      await fn();
      passed += 1;
      console.log(`✓ ${name}`);
    } catch (err) {
      console.error(`✗ ${name}`);
      console.error(err.stack || err);
      process.exit(1);
    }
  }

  console.log(`\n${passed}/${tests.length} lib smoke tests passed.`);
})().catch(err => {
  console.error(err.stack || err);
  process.exit(1);
});
