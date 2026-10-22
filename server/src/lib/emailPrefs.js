// Which optional emails an account gets. Each is on unless turned off: the weekly summary comes with
// every plan, shift alerts with plans that include them.
const { planLimits } = require("./plans");

const EMAIL_LISTS = ["weekly_summary", "shift_alerts"];
const LIST_FEATURE = { weekly_summary: null, shift_alerts: "shiftAlerts" };

function emailAvailable(account, list) {
    const limits = planLimits(account.plan);
    const feature = LIST_FEATURE[list];
    return !!limits && (!feature || !!limits[feature]);
}

function wantsEmail(account, list) {
    if (account.deletion_requested_at) return false;
    const pref = account.email_prefs?.[list];
    return emailAvailable(account, list) && pref !== false;
}

module.exports = { EMAIL_LISTS, wantsEmail, emailAvailable };
