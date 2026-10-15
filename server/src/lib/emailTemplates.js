// Plain, light emails that read the same in every mail app: inline styles, one column, a text version.
const SITE = "https://tracetray.com";

const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

const paragraph = (text, size = 16) => `<p style="margin:0 0 ${size === 16 ? 16 : 10}px;font-size:${size}px;line-height:1.55;color:#3f465c">${escapeHtml(text)}</p>`;

function layout(title, bodyHtml, button, footer = "") {
    const cta = button
        ? `<p style="margin:24px 0 8px"><a href="${button.href}" style="display:inline-block;background:#1c2030;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:10px">${escapeHtml(button.label)}</a></p>`
        : "";
    return `<!doctype html><html><body style="margin:0;padding:0;background:#eef1f6">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f6;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;font-family:'Helvetica Neue',Arial,sans-serif">
<tr><td>
<p style="margin:0 0 24px"><img src="${SITE}/icon-192.png" width="32" height="32" alt="" style="vertical-align:middle;border-radius:8px"> <span style="vertical-align:middle;font-weight:700;font-size:18px;color:#1c2030">TraceTray</span></p>
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#1c2030">${escapeHtml(title)}</h1>
${bodyHtml}${cta}
</td></tr></table>
<p style="margin:16px 0 0;font-size:13px;color:#646a80;font-family:'Helvetica Neue',Arial,sans-serif">Questions? Reply to this email or write to support@tracetray.com.${footer}</p>
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
        text: [title, ...lines, `Keep your data: ${SITE}/pricing`, "Questions? Reply to this email or write to support@tracetray.com."].join("\n\n"),
        html: layout(title, lines.map(line => paragraph(line)).join(""), { href: `${SITE}/pricing`, label: "Keep my data" })
    };
}

const percent = value => `${Math.round(value * 100)}%`;
const signed = value => `${value > 0 ? "up" : "down"} ${percent(Math.abs(value))}`;
const count = value => value.toLocaleString("en-CA");

// Page keys are full addresses or group patterns. Emails name them as the dashboard does:
// "Home", a group as "Product pages", any other page by its path.
function pathOf(page) {
    let path;
    try { path = new URL(page).pathname || "/"; } catch { path = String(page); }
    if (path === "/") return "Home";
    const segments = path.split("/").filter(Boolean);
    if (!segments.some(s => s.startsWith(":"))) return path;
    const last = segments[segments.length - 1];
    const name = last.startsWith(":") ? last.slice(1) : last;
    if (name !== "id") return `${name.replace(/[_-]/g, " ")} pages`.replace(/^./, c => c.toUpperCase());
    const parent = segments.filter(s => !s.startsWith(":")).pop() || "item";
    const single = parent.endsWith("ies") ? `${parent.slice(0, -3)}y` : parent.endsWith("s") && parent.length > 3 ? parent.slice(0, -1) : parent;
    return `${single} pages`.replace(/^./, c => c.toUpperCase());
}

function siteLines(site) {
    if (!site.visits) return ["No visits last week. If that's unexpected, check that the tracking snippet is still on the site."];
    const lines = [`${count(site.visits)} visits${site.change === null ? "" : `, ${signed(site.change)} on the week before`}. ${percent(site.mobileShare)} were on phones.`];
    if (site.topPages.length) lines.push(`Busiest pages: ${site.topPages.map(p => `${pathOf(p.page)} (${count(p.visits)})`).join(", ")}.`);
    if (site.mover) lines.push(`Moved most: ${pathOf(site.mover.page)}, ${signed(site.mover.change)}.`);
    for (const shift of site.shifts) lines.push(`On ${pathOf(shift.page)}, ${shift.group} went from ${percent(shift.from)} to ${percent(shift.to)} of visitors.`);
    return lines;
}

// Sent on Mondays: last week per website, against the week before.
function weeklySummary({ from, to, sites, unsubscribe }) {
    const title = `Your week: ${formatDay(from)} to ${formatDay(to)}`;
    const total = sites.reduce((sum, site) => sum + site.visits, 0);
    const subject = sites.length === 1
        ? `Your week on TraceTray: ${count(sites[0].visits)} visits${sites[0].change === null ? "" : `, ${signed(sites[0].change)}`}`
        : `Your week on TraceTray: ${count(total)} visits across ${sites.length} websites`;
    const blocks = sites.map(site => ({ name: site.name, lines: siteLines(site) }));
    const bodyHtml = blocks.map(block =>
        `<p style="margin:8px 0 6px;font-size:17px;font-weight:700;color:#1c2030">${escapeHtml(block.name)}</p>${block.lines.map(line => paragraph(line, 15)).join("")}`
    ).join("");
    const text = [
        title,
        ...blocks.map(block => [block.name, ...block.lines].join("\n")),
        `Open your dashboard: ${SITE}/app/`,
        ...(unsubscribe ? [`Stop these weekly emails: ${unsubscribe}`] : [])
    ].join("\n\n");
    const footer = unsubscribe ? ` <a href="${unsubscribe}" style="color:#646a80">Stop these weekly emails</a>.` : "";
    return { subject, text, html: layout(title, bodyHtml, { href: `${SITE}/app/`, label: "Open your dashboard" }, footer) };
}

// Sent after the weekly analysis when a page's visitor groups moved 10 points or more.
function shiftAlert({ shifts, unsubscribe }) {
    const title = shifts.length === 1 ? "Visitors changed on one of your pages" : `Visitors changed on ${shifts.length} of your pages`;
    const lines = shifts.map(s => `${pathOf(s.page)} on ${s.site}: ${s.group} went from ${percent(s.from)} to ${percent(s.to)} of visitors.`);
    const intro = "This week's analysis found a bigger shift than usual. Worth a look, especially if you changed something.";
    const footer = unsubscribe ? ` <a href="${unsubscribe}" style="color:#646a80">Stop these alerts</a>.` : "";
    return {
        subject: shifts.length === 1 ? `Visitors shifted on ${pathOf(shifts[0].page)}` : `Visitors shifted on ${shifts.length} of your pages`,
        text: [title, intro, ...lines, `Open your dashboard: ${SITE}/app/`, ...(unsubscribe ? [`Stop these alerts: ${unsubscribe}`] : [])].join("\n\n"),
        html: layout(title, paragraph(intro) + lines.map(line => paragraph(line, 15)).join(""), { href: `${SITE}/app/`, label: "Open your dashboard" }, footer)
    };
}

module.exports = { deletionNotice, weeklySummary, shiftAlert, escapeHtml };
