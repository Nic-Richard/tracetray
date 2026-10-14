// How much of its plan an account has used this month: visits and pages come from page_days,
// Ask questions from a counter on the account that starts over each month.
const { Account, PageDay } = require("../db/models");
const { getAccountSites } = require("./siteAccount");

function monthOf(date = new Date()) {
    return date.toISOString().slice(0, 7);
}

function monthRange(month) {
    const [year, m] = month.split("-").map(Number);
    const next = m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, "0")}`;
    return { from: `${month}-01`, to: `${next}-01` };
}

function askCount(account, month) {
    return account.ask_usage?.month === month ? account.ask_usage.count || 0 : 0;
}

async function getUsage(account, month = monthOf()) {
    const siteKeys = getAccountSites(account).map(site => site.key);
    const { from, to } = monthRange(month);
    const [totals] = await PageDay.aggregate([
        { $match: { site_key: { $in: siteKeys }, day: { $gte: from, $lt: to } } },
        { $group: { _id: { site: "$site_key", path: "$path" }, sessions: { $sum: "$sessions" } } },
        { $group: { _id: null, visits: { $sum: "$sessions" }, pages: { $sum: 1 } } }
    ]);
    return {
        month,
        visits: totals?.visits || 0,
        pages: totals?.pages || 0,
        sites: siteKeys.length,
        askQuestions: askCount(account, month)
    };
}

// One update either adds to this month's count or starts a new month at 1, so two answers
// landing together can't both reset it.
function recordAskQuestion(accountId, month = monthOf()) {
    return Account.updateOne({ _id: accountId }, [{
        $set: {
            ask_usage: {
                $cond: [
                    { $eq: ["$ask_usage.month", month] },
                    { month, count: { $add: [{ $ifNull: ["$ask_usage.count", 0] }, 1] } },
                    { month, count: 1 }
                ]
            }
        }
    }], { updatePipeline: true });
}

module.exports = { getUsage, recordAskQuestion, askCount, monthOf, monthRange };
