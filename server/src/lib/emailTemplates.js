// Plain, light emails that read the same in every mail app: inline styles, one column, a text version.
const SITE = "https://tracetray.com";

const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

function layout(title, paragraphs, button) {
    const body = paragraphs.map(p => `<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:#3f465c">${p}</p>`).join("");
    const cta = button
        ? `<p style="margin:24px 0 8px"><a href="${button.href}" style="display:inline-block;background:#1c2030;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:10px">${escapeHtml(button.label)}</a></p>`
        : "";
    return `<!doctype html><html><body style="margin:0;padding:0;background:#eef1f6">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f6;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;font-family:'Helvetica Neue',Arial,sans-serif">
<tr><td>
<p style="margin:0 0 24px"><img src="${SITE}/icon-192.png" width="32" height="32" alt="" style="vertical-align:middle;border-radius:8px"> <span style="vertical-align:middle;font-weight:700;font-size:18px;color:#1c2030">TraceTray</span></p>
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#1c2030">${escapeHtml(title)}</h1>
${body}${cta}
</td></tr></table>
<p style="margin:16px 0 0;font-size:13px;color:#646a80;font-family:'Helvetica Neue',Arial,sans-serif">Questions? Reply to this email or write to support@tracetray.com.</p>
</td></tr></table></body></html>`;
}

function formatDay(date) {
    return new Date(date).toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// Sent 7 days before a cancelled account's data is deleted.
function deletionNotice({ siteNames, deleteOn }) {
    const day = formatDay(deleteOn);
    const sites = siteNames.length ? siteNames.join(", ") : "your websites";
    const title = `Your TraceTray data will be deleted on ${day}`;
    const lines = [
        `Your subscription has ended, so the visits, visitor groups and history for ${sites} will be deleted on ${day}.`,
        "TraceTray is still collecting visits until then. Pick a plan before that date and everything stays, including what was collected in the meantime.",
        "If you'd rather let it go, there's nothing to do."
    ];
    return {
        subject: title,
        text: `${title}\n\n${lines.join("\n\n")}\n\nKeep your data: ${SITE}/pricing.html\n\nQuestions? Reply to this email or write to support@tracetray.com.`,
        html: layout(title, lines.map(escapeHtml), { href: `${SITE}/pricing.html`, label: "Keep my data" })
    };
}

module.exports = { deletionNotice, escapeHtml };
