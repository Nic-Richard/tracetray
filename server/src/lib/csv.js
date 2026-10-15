// CSV for spreadsheets. Page paths and group names come from the public internet, so a cell that
// would start a formula in Excel or Sheets is prefixed with ' (it opens as text, not a formula).
function cell(value) {
    if (value === null || value === undefined) return "";
    let text = String(value);
    if (/^[=+\-@\t\r]/.test(text) && typeof value !== "number") text = `'${text}`;
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(header, rows) {
    return [header, ...rows].map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

module.exports = { toCsv, cell };
