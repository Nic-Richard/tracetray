// What each plan includes. null = no limit. Visits and Ask questions are per calendar month (UTC).
// goals is per website; formGoals and paths are Ultra's extras. weeklyPages is how many pages the weekly automatic analysis covers; 0 means the plan doesn't include it.
// Enterprise is agreed per customer and set by hand.
const PLANS = {
    starter:    { name: "Starter",    visits: 10000,    pages: 50,    sites: 1,     historyDays: 183,   askQuestions: 50,    goals: 10,   weeklyPages: 0,    shiftAlerts: false, csvExport: false, fullGroupSearch: false, formGoals: false, paths: false },
    pro:        { name: "Pro",        visits: 100000,   pages: 500,   sites: 5,     historyDays: 730,   askQuestions: 300,   goals: 20,   weeklyPages: 25,   shiftAlerts: true,  csvExport: true,  fullGroupSearch: true,  formGoals: false, paths: false },
    ultra:      { name: "Ultra",      visits: 1000000,  pages: 2000,  sites: 10,    historyDays: 1461,  askQuestions: 750,   goals: 50,   weeklyPages: 100,  shiftAlerts: true,  csvExport: true,  fullGroupSearch: true,  formGoals: true,  paths: true },
    enterprise: { name: "Enterprise", visits: 5000000,  pages: null,  sites: null,  historyDays: null,  askQuestions: 1500,  goals: 200,  weeklyPages: 250,  shiftAlerts: true,  csvExport: true,  fullGroupSearch: true,  formGoals: true,  paths: true }
};

// Stripe prices are found by lookup key, so changing a price in Stripe needs no code or .env change.
const PRICE_KEYS = {
    starter: { month: "tracetray_starter_monthly", year: "tracetray_starter_yearly" },
    pro:     { month: "tracetray_pro_monthly",     year: "tracetray_pro_yearly" },
    ultra:   { month: "tracetray_ultra_monthly",   year: "tracetray_ultra_yearly" }
};

function planLimits(plan) {
    return PLANS[plan] || null;
}

// Subscriptions from before lookup keys carry only the old price IDs from .env.
function planForPrice(price) {
    const key = price?.lookup_key;
    for (const [plan, keys] of Object.entries(PRICE_KEYS)) {
        if (Object.values(keys).includes(key)) return plan;
    }
    return price?.id === process.env.STRIPE_PRO_PRICE_ID ? "pro" : "starter";
}

module.exports = { PLANS, PRICE_KEYS, planLimits, planForPrice };
