const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { parseAction } = require('../src/lib/moderationAuth');

function fixture() {
    let active = true, writes = 0;
    const reports = new Map(['a', 'b'].map(letter => [letter.repeat(24), { _id: letter.repeat(24), account_id: 'owner', site_key: 'site', category: 'bug', description: 'Broken button', status: 'open' }]));
    const query = value => ({ lean: async () => structuredClone(value) });
    const models = {
        Account: { exists: async () => active },
        BugReport: {
            findOne: filter => query([...reports.values()].find(r => r.moderation_history?.some(entry => entry.requestId === filter['moderation_history.requestId']))),
            findById: id => query(reports.get(id)),
            findOneAndUpdate: async (filter, update) => {
                const report = reports.get(filter._id);
                if (report.status !== filter.status || (typeof filter['moderation.requestId'] === 'string' ? report.moderation?.requestId !== filter['moderation.requestId'] : report.moderation?.requestId !== undefined)) return null;
                Object.assign(report, structuredClone(update.$set)); report.moderation_history ||= []; report.moderation_history.push(structuredClone(update.$push.moderation_history)); writes++;
                return report;
            },
        },
    };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(require.resolve('../src/lib/reportModeration'), 'utf8'), {
        module, require: name => name === '../db/models' ? models : require('../src/lib/moderationAuth'), Date,
    });
    const call = (action, overrides = {}) => module.exports.moderateReport({ action, target: { kind: 'report', id: 'a'.repeat(24) }, requestId: crypto.randomUUID(), actor: { id: '123', name: 'Mod' }, ...overrides });
    return { call, writes: () => writes, closeAccount: () => { active = false; } };
}

test('report decisions are saved once and replay the same receipt', async () => {
    const f = fixture();
    const state = await f.call('inspect');
    const operation = { expectedVersion: state.version, requestId: crypto.randomUUID() };
    const result = await f.call('dismiss', operation);
    assert.equal(result.status, 'dismissed');
    assert.equal(JSON.stringify(await f.call('dismiss', operation)), JSON.stringify(result));
    assert.equal(f.writes(), 1);
    assert.equal((await f.call('inspect')).status, 'dismissed');
    await assert.rejects(f.call('dismiss', { ...operation, target: { kind: 'report', id: 'b'.repeat(24) } }), /another action/);
});

test('stale and unsupported decisions cannot mutate reports; closing accounts cannot be moderated', async () => {
    const f = fixture();
    await assert.rejects(f.call('resolve', { expectedVersion: 'stale' }), /changed/);
    await assert.rejects(f.call('remove', { expectedVersion: (await f.call('inspect')).version }), /changed/);
    f.closeAccount();
    await assert.rejects(f.call('inspect'), /no longer available/);
    assert.equal(f.writes(), 0);
});

test('concurrent decisions preserve the first moderator outcome', async () => {
    const f = fixture();
    const expectedVersion = (await f.call('inspect')).version;
    const results = await Promise.all([f.call('resolve', { expectedVersion }), f.call('dismiss', { expectedVersion })]);
    assert.equal(f.writes(), 1);
    assert.equal(results[0].status, results[1].status);
    assert.equal(results[1].changed, false);
});

test('signed callbacks reject malformed JSON structures and negative permissions', () => {
    const secret = 's'.repeat(40), timestamp = String(Math.floor(Date.now() / 1000));
    for (const data of [null, [], { action: 'resolve', requestId: crypto.randomUUID(), target: { kind: 'report', id: 'a'.repeat(24) }, actor: { id: '123', name: 'Mod', permissions: '-1' } }]) {
        const raw = Buffer.from(JSON.stringify(data));
        const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest('hex');
        assert.throws(() => parseAction(raw, { 'x-action-timestamp': timestamp, 'x-action-signature': signature }, secret), error => [400, 403].includes(error.status));
    }
});

test('reopening retains every receipt and prevents stale decisions after returning to open', async () => {
    const f = fixture();
    const initial = await f.call('inspect');
    const operation = { requestId: crypto.randomUUID(), expectedVersion: initial.version };
    const closed = await f.call('dismiss', operation);
    const reopened = await f.call('reopen', { expectedVersion: closed.version });
    assert.equal(reopened.status, 'open');
    assert.notEqual(reopened.version, initial.version);
    assert.equal(JSON.stringify(await f.call('dismiss', operation)), JSON.stringify(closed));
    assert.equal((await f.call('inspect')).status, 'open');
    await assert.rejects(f.call('resolve', { expectedVersion: initial.version }), /changed/);
    assert.equal((await f.call('resolve', { expectedVersion: reopened.version })).status, 'resolved');
    assert.equal(f.writes(), 3);
});
