async function eraseAccountAlerts(references, cursor = {}) {
    const { ALERTS_URL, ALERTS_SECRET } = process.env;
    if (!ALERTS_URL && !ALERTS_SECRET) return { complete: true, cursor: {} };
    if (!ALERTS_URL || !ALERTS_SECRET) throw new Error("Alert erasure configuration is incomplete");
    const url = new URL(ALERTS_URL);
    if (!url.pathname.endsWith("/alert")) throw new Error("Alert erasure needs an /alert relay URL");
    url.pathname = url.pathname.slice(0, -6) + "/erase";
    url.search = "";
    const response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${ALERTS_SECRET}`, "Content-Type": "application/json" },
        body: JSON.stringify({ app: "tracetray", references, cursor }),
        signal: AbortSignal.timeout(45_000)
    });
    if (!response.ok) throw new Error(`Alert erasure failed (${response.status})`);
    const result = await response.json();
    if (typeof result.complete !== "boolean" || !result.cursor || typeof result.cursor !== "object" || Array.isArray(result.cursor) ||
        Object.entries(result.cursor).some(([key, value]) => !/^\d{1,20}$/.test(key) || typeof value !== "string" || (value !== "done" && !/^\d{1,20}$/.test(value)))) {
        throw new Error("Alert relay returned invalid erasure progress");
    }
    return { complete: result.complete, cursor: result.cursor };
}

module.exports = { eraseAccountAlerts };
