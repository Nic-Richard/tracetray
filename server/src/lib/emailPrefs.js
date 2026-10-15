// Which optional emails an account gets. Once plans are live each is on unless turned off: the weekly
// summary comes with every plan, shift alerts with plans that include them. During the beta only accounts
// that turn one on get it.
const { TRACETRAY_MODE } = require("../config");
const { planLimits } = require("./plans");

const EMAIL_LISTS = ["weekly_summary", "shift_alerts"];
const LIST_FEATURE = { weekly_summary: null, shift_alerts: "shiftAlerts" };

function emailAvailable(account, list, mode = TRACETRAY_MODE) {
    if (mode !== "production") return true;
    const limits = planLimits(account.plan);
    const feature = LIST_FEATURE[list];
    return !!limits && (!feature || !!limits[feature]);
}

function wantsEmail(account, list, mode = TRACETRAY_MODE) {
    const pref = account.email_prefs?.[list];
    if (mode !== "production") return pref === true;
    return emailAvailable(account, list, mode) && pref !== false;
}

module.exports = { EMAIL_LISTS, wantsEmail, emailAvailable };
