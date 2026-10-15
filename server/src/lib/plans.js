// What each plan includes. null = no limit. Visits and Ask questions are per calendar month (UTC).
const PLANS = {
    starter:    { name: "Starter",    visits: 10000,   pages: 50,   sites: 1,    historyDays: 183,  askQuestions: 50 },
    pro:        { name: "Pro",        visits: 100000,  pages: 500,  sites: 5,    historyDays: 730,  askQuestions: 300 },
    enterprise: { name: "Enterprise", visits: 1000000, pages: null, sites: null, historyDays: null, askQuestions: 1500 }
};

// Stripe prices are found by lookup key, so changing a price in Stripe needs no code or .env change.
const PRICE_KEYS = {
    starter: { month: "tracetray_starter_monthly", year: "tracetray_starter_yearly" },
    pro:     { month: "tracetray_pro_monthly",     year: "tracetray_pro_yearly" }
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
