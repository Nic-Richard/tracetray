const { Account, BugReport } = require('../db/models');
const { ActionError } = require('./moderationAuth');

async function moderateReport(data) {
    if (data.target.kind !== 'report' || !/^[a-f0-9]{24}$/i.test(data.target.id)) throw new ActionError('Invalid report target', 400);
    const receipt = await BugReport.findOne({ 'moderation_history.requestId': data.requestId }).lean();
    if (receipt) {
        const previous = receipt.moderation_history.find(entry => entry.requestId === data.requestId);
        if (String(receipt._id) !== data.target.id || previous.action !== data.action) throw new ActionError('That request belongs to another action');
        return previous.result;
    }
    const report = await BugReport.findById(data.target.id).lean();
    if (!report || !await Account.exists({ _id: report.account_id, deletion_requested_at: null })) throw new ActionError('Report is no longer available', 404);
    const status = report.status === 'open' ? 'open' : report.moderation?.result?.status || 'resolved';
    const state = { ok: true, status, version: `${report._id}:${status}:${report.moderation?.requestId || "initial"}`, title: `${report.category} report`, summary: report.description.slice(0, 1000), actions: status === 'open' ? ['resolve', 'dismiss'] : ['reopen'], confirmations: { reopen: 'Reopen this report for review. Previous decisions remain in the audit history.' }, references: [String(report._id), String(report.account_id), report.site_key], actor: report.moderation?.result?.actor || null };
    if (data.action === 'inspect') return state;
    if (status !== 'open' && !state.actions.includes(data.action)) return { ...state, changed: false, summary: 'This report was already handled in the app' };
    if (data.expectedVersion !== state.version || !state.actions.includes(data.action)) throw new ActionError('Report changed; review it again');
    const result = { ok: true, changed: true, status: data.action === 'reopen' ? 'open' : data.action === 'dismiss' ? 'dismissed' : 'resolved', summary: `Report ${data.action === 'reopen' ? 'reopened' : data.action === 'dismiss' ? 'dismissed' : 'resolved'}`, actor: data.actor, requestId: data.requestId, at: Date.now() };
    result.version = `${report._id}:${result.status}:${data.requestId}`;
    result.actions = result.status === 'open' ? ['resolve', 'dismiss'] : ['reopen'];
    const entry = { requestId: data.requestId, action: data.action, actor: data.actor.id, at: new Date(), result };
    const updated = await BugReport.findOneAndUpdate(
        { _id: report._id, status: report.status, 'moderation.requestId': report.moderation?.requestId || { $exists: false } },
        { $set: { status: result.status === 'open' ? 'open' : 'resolved', moderation: entry }, $push: { moderation_history: entry } },
        { new: true }
    );
    if (!updated) return moderateReport(data);
    return result;
}
module.exports = { moderateReport };
