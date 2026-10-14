// What each plan includes. null = no limit. Visits and Ask questions are per calendar month (UTC).
const PLANS = {
    starter:    { name: "Starter",    visits: 10000,   pages: 50,   sites: 1,    historyDays: 183,  askQuestions: 50 },
    pro:        { name: "Pro",        visits: 100000,  pages: 500,  sites: 5,    historyDays: 730,  askQuestions: 300 },
    enterprise: { name: "Enterprise", visits: 1000000, pages: null, sites: null, historyDays: null, askQuestions: 1500 }
};

function planLimits(plan) {
    return PLANS[plan] || null;
}

module.exports = { PLANS, planLimits };
