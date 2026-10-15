// Which optional emails an account gets. Each is a Pro feature once plans are live (on unless turned
// off); during the beta only accounts that turn one on get it.
const { TRACETRAY_MODE } = require("../config");

const EMAIL_LISTS = ["weekly_summary", "shift_alerts"];
const EMAIL_PLANS = ["pro", "enterprise"];

function wantsEmail(account, list, mode = TRACETRAY_MODE) {
    const pref = account.email_prefs?.[list];
    if (mode !== "production") return pref === true;
    return EMAIL_PLANS.includes(account.plan) && pref !== false;
}

function emailAvailable(account, mode = TRACETRAY_MODE) {
    return mode !== "production" || EMAIL_PLANS.includes(account.plan);
}

module.exports = { EMAIL_LISTS, wantsEmail, emailAvailable };
