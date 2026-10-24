// Gives an existing account a free plan for a set number of days, without Stripe. The plan ends on
// its own (jobs/compAccess.js). Accounts that already pay are left alone.
// docker compose exec server node scripts/grant-plan.js <email> [plan=pro] [days=30]
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });
const mongoose = require("mongoose");
const { MONGODB_URI } = require("../src/config");
const { Account } = require("../src/db/models");
const { PLANS } = require("../src/lib/plans");

const ENDED = ["canceled", "unpaid", "incomplete_expired"];

(async () => {
    const [email, plan = "pro", days = "30"] = process.argv.slice(2);
    if (!email || !PLANS[plan] || !(Number(days) > 0)) {
        console.error("usage: node scripts/grant-plan.js <email> [starter|pro|ultra] [days]");
        process.exit(1);
    }
    await mongoose.connect(MONGODB_URI);
    const matches = await Account.find({ email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }).lean();
    if (matches.length !== 1) throw new Error(matches.length ? "more than one account has that email" : "no account with that email; they need to sign in once first");
    const account = matches[0];
    if (account.subscription && !ENDED.includes(account.subscription.status)) throw new Error(`they already pay for ${account.plan}`);
    if (account.plan !== "none" && !account.comp_until) throw new Error(`they already have ${account.plan} without an end date`);

    const until = new Date(Date.now() + Number(days) * 24 * 60 * 60 * 1000);
    await Account.updateOne({ _id: account._id }, { $set: { plan, comp_until: until } });
    console.log(`${account.email}: ${plan} until ${until.toISOString().slice(0, 10)}`);
    await mongoose.disconnect();
})().catch(err => {
    console.error(err.message || err);
    process.exit(1);
});
