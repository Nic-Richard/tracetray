const { interpretClusters } = require("./interpretClusters");
const { matchChanged } = require("./goals");

function findingSnapshot(analysis, reference) {
    if (!analysis || !reference || !["desktop", "mobile"].includes(reference.device)) return null;
    const source = reference.device === "mobile" ? analysis.mobile : analysis;
    if (!source?.clusters?.length || source.structure === "none" || source.session_count < 100) return null;
    const interpretation = analysis.interpretation?.source === "rules"
        ? interpretClusters({ desktop: analysis, mobile: analysis.mobile, pageUrl: analysis.page, goal: analysis.goal })
        : analysis.interpretation || analysis.ai_interpretation;
    const item = interpretation?.advice?.find(a => a.action === reference.action && a.group === reference.group
        && (a.devices || [a.device]).includes(reference.device));
    if (!item?.evidence?.trim() || !item.action.trim()) return null;
    return { ran_at: new Date(analysis.ran_at).toISOString(), device: reference.device, group: item.group,
        action: item.action, evidence: item.evidence, session_count: source.session_count,
        inactive_count: source.inactive_count ?? null, scope: source.scope || null,
        related_scopes: (item.devices || [item.device]).filter(device => device !== reference.device).map(device => {
            const other = device === "mobile" ? analysis.mobile : analysis;
            return { device, session_count: other?.session_count || 0, inactive_count: other?.inactive_count ?? null, scope: other?.scope || null };
        }),
        goal_informed: analysis.goal ? source.k_rationale?.goal_informed ?? null : false };
}

function goalSnapshot(goal) {
    if (!goal) return null;
    return { id: goal.id, name: goal.name, type: goal.type, match: goal.match, pages: [...(goal.pages || [])],
        measurement_version: goal.measurement_version || 0 };
}

function goalForChange(site, change) {
    const saved = change.goal_snapshot;
    if (!saved) return { goal: null, goal_status: "none" };
    const current = (site.goals || []).find(g => g.id === saved.id);
    if (!current || current.type !== saved.type || matchChanged(saved, current)
        || (current.measurement_version || 0) !== (saved.measurement_version || 0)) {
        return { goal: null, goal_status: "changed" };
    }
    if (current.backfill && current.backfill !== "done") return { goal: null, goal_status: "backfilling" };
    return { goal: saved, goal_status: "ready" };
}

module.exports = { findingSnapshot, goalSnapshot, goalForChange };
