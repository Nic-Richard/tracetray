# Clusters desktop and mobile interaction features separately.

import json
import math
import os
import sys
import argparse
import warnings

import numpy as np
import pandas as pd

import goal_model

from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans, AgglomerativeClustering
from sklearn.exceptions import ConvergenceWarning
from sklearn.metrics import silhouette_score, davies_bouldin_score, calinski_harabasz_score, adjusted_rand_score
from scipy.stats import kruskal
from scipy.optimize import linear_sum_assignment

# K-means warns when a page has many identical visits, and pandas about future defaults; neither changes a result.
warnings.filterwarnings("ignore", category=ConvergenceWarning)
warnings.filterwarnings("ignore", category=FutureWarning)



DATASET_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "features")
RANDOM_SEED = 42

# More groups than this stop being something a site owner can act on.
MAX_GROUPS = 5
MIN_GROUP_SIZE = 8
# A smaller k wins unless a larger one separates visitors clearly better.
SILHOUETTE_TOLERANCE = 0.02
GOAL_SILHOUETTE_TOLERANCE = 0.06
GOAL_SEPARATION_GAIN = 0.05
NULL_REPS = 10
STABILITY_REPS = 10
SILHOUETTE_SAMPLE = 2000
WARD_SAMPLE = 3000
SNAPSHOT_POINTS = 300
# Kruskal-Wallis epsilon squared; around 0.08 is a medium effect.
MEDIUM_EFFECT = 0.08

DESKTOP_ENGINEERED_FEATURES = [
    "pause_rate", "click_rate", "move_density", "distance_per_move",
    "avg_cursor_velocity", "dwell_before_click",
    "spatial_entropy", "top_zone_ratio", "centre_zone_ratio", "bottom_zone_ratio",
    "scroll_depth_reached", "direction_change_rate", "scroll_burst_rate"
]

MOBILE_ENGINEERED_FEATURES = [
    "tap_rate", "scroll_velocity_rate", "attention_pause_rate",
    "avg_attention_pause_ms", "dwell_before_tap", "scroll_depth_reached",
    "direction_change_rate", "scroll_burst_rate"
]

# The three zone shares add up to one, so the middle one adds nothing to the clustering.
CLUSTER_EXCLUDED = {"centre_zone_ratio"}

# Shares are already on a 0-1 scale; counts, rates and times are right-skewed, so they're log-scaled
# before clustering or a few very busy visits decide the groups.
UNSKEWED = {"spatial_entropy", "top_zone_ratio", "centre_zone_ratio", "bottom_zone_ratio", "scroll_depth_reached"}

# Waits before a click or tap only exist for visits that clicked or tapped.
ONLY_WHEN_ACTED = {"dwell_before_click", "dwell_before_tap"}

CURSOR_FEATURES = {"pause_rate", "move_density", "distance_per_move", "avg_cursor_velocity", "dwell_before_click",
                   "spatial_entropy", "top_zone_ratio", "centre_zone_ratio", "bottom_zone_ratio"}

FILL_TYPICAL = ONLY_WHEN_ACTED | CURSOR_FEATURES



def load_dataset(dataset_dir, site_key, device):
    path = os.path.join(dataset_dir, f"dataset_{site_key}_{device}.json")
    if not os.path.exists(path):
        print(f"no dataset found at {path}")
        sys.exit(1)

    with open(path) as f:
        data = json.load(f)

    print(f"  loaded {len(data)} {device} sessions from {os.path.basename(path)}")
    return pd.DataFrame(data)


def load_meta(dataset_dir, site_key, device):
    path = os.path.join(dataset_dir, f"dataset_{site_key}_meta.json")
    try:
        with open(path) as f:
            return json.load(f).get(device) or {}
    except (OSError, ValueError):
        return {}


def active_seconds(df):
    # Older datasets only have the wall-clock duration, which includes time the tab sat in the background.
    active = df["active_ms"] if "active_ms" in df.columns else df["duration_ms"]
    return (active.fillna(df["duration_ms"]) / 1000).replace(0, np.nan)


def engineer_desktop_features(df):
    df = df.copy()
    df["duration_s"] = active_seconds(df)

    df["pause_rate"]   = df["cursor_pauses"] / df["duration_s"]
    df["click_rate"]   = df["clicks"]        / df["duration_s"]
    df["move_density"] = df["mouse_moves"]   / df["duration_s"]

    df["distance_per_move"] = np.where(df["mouse_moves"] > 0, df["total_cursor_distance"] / df["mouse_moves"].replace(0, np.nan), 0)
    df["direction_change_rate"] = df["scroll_direction_changes"] / df["duration_s"]
    df["scroll_burst_rate"] = df["scroll_bursts"] / df["duration_s"]

    grid_cols = [f"grid_{r}_{c}" for r in range(3) for c in range(3)]
    for col in grid_cols:
        if col not in df.columns:
            df[col] = 0
    df[grid_cols] = df[grid_cols].fillna(0)
    grid_total = df[grid_cols].sum(axis=1).replace(0, np.nan)
    shares = df[grid_cols].div(grid_total, axis=0)

    df["top_zone_ratio"]    = shares[["grid_0_0", "grid_0_1", "grid_0_2"]].sum(axis=1)
    df["centre_zone_ratio"] = shares[["grid_1_0", "grid_1_1", "grid_1_2"]].sum(axis=1)
    df["bottom_zone_ratio"] = shares[["grid_2_0", "grid_2_1", "grid_2_2"]].sum(axis=1)

    p = shares.to_numpy(dtype=float)
    with np.errstate(divide="ignore", invalid="ignore"):
        df["spatial_entropy"] = np.nansum(np.where(p > 0, -p * np.log2(p), 0), axis=1)

    df["dwell_before_click"] = df["dwell_before_click"].where(df["clicks"] > 0)
    # Scrolling with a trackpad or keyboard leaves no cursor trail; those measures are unknown for the visit, not zero.
    no_cursor = df["mouse_moves"].fillna(0) <= 0
    df.loc[no_cursor, list(CURSOR_FEATURES)] = np.nan
    return fill_missing(df, DESKTOP_ENGINEERED_FEATURES)


def engineer_mobile_features(df):
    df = df.copy()
    df["duration_s"] = active_seconds(df)

    if "taps" in df.columns:
        df["tap_rate"] = df["taps"] / df["duration_s"]
    if "attention_pauses" in df.columns:
        df["attention_pause_rate"] = df["attention_pauses"] / df["duration_s"]
    df["scroll_velocity_rate"] = df["scroll_velocity"]
    df["direction_change_rate"] = df["scroll_direction_changes"] / df["duration_s"]
    df["scroll_burst_rate"] = df["scroll_bursts"] / df["duration_s"]

    df["dwell_before_tap"] = df["dwell_before_tap"].where(df["dwell_before_tap"] > 0)
    return fill_missing(df, MOBILE_ENGINEERED_FEATURES)


def fill_missing(df, features):
    for col in features:
        df[col] = df[col].replace([np.inf, -np.inf], np.nan)
        if col not in FILL_TYPICAL:
            df[col] = df[col].fillna(0)
    return df


def fill_from_observed(values, rng):
    """Unknown values take a value drawn from visits where it was measured. A single typical value would stack every
    such visit on one point, and that stack alone can look like a group."""
    known = values.dropna().to_numpy()
    if len(known) == 0:
        return values.fillna(0)
    missing = values.isna()
    values = values.copy()
    values[missing] = rng.choice(known, size=int(missing.sum()))
    return values


def clustering_matrix(df, features):
    """Fills unknown values from visits where they were measured, log-scales skewed features, standardizes, clips
    outliers and drops features that don't vary. Returns the matrix, the features it kept and the values before
    standardizing, which describe each group in units that stay comparable from one analysis to the next."""
    cols, kept = [], []
    rng = np.random.default_rng(RANDOM_SEED)
    for feat in features:
        if feat in CLUSTER_EXCLUDED:
            continue
        values = df[feat].astype(float)
        if feat in FILL_TYPICAL:
            values = fill_from_observed(values, rng)
        values = values.clip(lower=0)
        if feat not in UNSKEWED:
            values = np.log1p(values)
        if values.std() < 1e-9:
            continue
        cols.append(values.to_numpy())
        kept.append(feat)
    if not cols:
        return None, [], None
    T = np.column_stack(cols)
    X = StandardScaler().fit_transform(T)
    return np.clip(X, -4, 4), kept, T



def silhouette(X, labels, seed=RANDOM_SEED):
    if len(set(labels)) < 2:
        return -1.0
    size = min(len(X), SILHOUETTE_SAMPLE)
    return float(silhouette_score(X, labels, sample_size=size, random_state=seed))


def fit_kmeans(X, k, seed=RANDOM_SEED, n_init=20):
    return KMeans(n_clusters=k, random_state=seed, n_init=n_init).fit(X)


def min_group_size(n):
    return max(MIN_GROUP_SIZE, int(math.ceil(0.05 * n)))


def compute_k_range(n_sessions, min_size):
    """None when there aren't enough visits for two groups of the minimum size."""
    if n_sessions < min_size * 2:
        return None
    return range(2, min(n_sessions // min_size, MAX_GROUPS) + 1)


def goal_separation(labels, reached):
    """Cramér's V between the groups and reaching the goal: 0 when every group converts alike, 1 when the groups
    split converters from the rest completely."""
    table = pd.crosstab(labels, reached).to_numpy()
    if table.shape[1] < 2:
        return 0.0
    expected = table.sum(axis=1, keepdims=True) * table.sum(axis=0, keepdims=True) / table.sum()
    chi2 = float(((table - expected) ** 2 / expected).sum())
    return float(np.sqrt(chi2 / (table.sum() * (min(table.shape) - 1))))


def select_k(X, k_range, min_size, reached=None):
    rows = []
    for k in k_range:
        km = fit_kmeans(X, k)
        sizes = np.bincount(km.labels_, minlength=k)
        rows.append({
            "goal_separation": goal_separation(km.labels_, reached) if reached is not None else None,
            "k": k,
            "silhouette": silhouette(X, km.labels_),
            "davies_bouldin": davies_bouldin_score(X, km.labels_),
            "calinski_harabasz": calinski_harabasz_score(X, km.labels_),
            "inertia": km.inertia_,
            "smallest_group": int(sizes.min()),
            "viable": bool(sizes.min() >= min_size)
        })
    metrics = pd.DataFrame(rows)
    viable = metrics[metrics["viable"]]
    if viable.empty:
        return metrics, None
    best = viable["silhouette"].max()
    chosen = int(viable[viable["silhouette"] >= best - SILHOUETTE_TOLERANCE]["k"].min())
    if reached is None:
        return metrics, chosen
    # Silhouette favours fewer groups and can merge two that convert very differently. A larger k wins only if it
    # still separates nearly as well, holds up on resampling and splits converters clearly better.
    current = float(metrics.loc[metrics["k"] == chosen, "goal_separation"].values[0])
    for row in viable[(viable["k"] > chosen) & (viable["silhouette"] >= best - GOAL_SILHOUETTE_TOLERANCE)].itertuples():
        if row.goal_separation >= current + GOAL_SEPARATION_GAIN:
            labels = fit_kmeans(X, row.k).labels_
            if stability(X, row.k, labels) >= 0.75:
                chosen, current = int(row.k), row.goal_separation
    return metrics, chosen


def null_silhouettes(X, k):
    """Silhouettes for data with the same spread and correlations as X but no groups at all (one Gaussian).
    Real groups should separate clearly better than that."""
    rng = np.random.default_rng(RANDOM_SEED)
    cov = np.cov(X, rowvar=False)
    out = []
    for i in range(NULL_REPS):
        fake = np.clip(rng.multivariate_normal(np.zeros(X.shape[1]), cov, size=len(X), method="eigh"), -4, 4)
        out.append(silhouette(fake, fit_kmeans(fake, k, seed=RANDOM_SEED + i, n_init=5).labels_))
    return out


def stability(X, k, labels):
    """Mean agreement (adjusted Rand) between the groups and re-clusterings of random 80% samples."""
    rng = np.random.default_rng(RANDOM_SEED)
    scores = []
    for i in range(STABILITY_REPS):
        idx = rng.choice(len(X), size=int(len(X) * 0.8), replace=False)
        sub = fit_kmeans(X[idx], k, seed=RANDOM_SEED + i, n_init=10).labels_
        scores.append(adjusted_rand_score(labels[idx], sub))
    return float(np.mean(scores))


def structure_verdict(sil, null, stab):
    """clear: well separated, beats groupless data and holds up on resampling. some: real but blurry.
    none: no better than groupless data, or the groups change from sample to sample."""
    beats_null = sil > max(null) + 0.02
    if beats_null and sil >= 0.25 and stab >= 0.75:
        return "clear"
    if beats_null and stab >= 0.6:
        return "some"
    return "none"


def cluster(X, k_range, min_size, reached=None):
    k_metrics, best_k = select_k(X, k_range, min_size, reached)
    if best_k is None:
        # Every split leaves a group too small to describe: a few unusual visits, not real groups.
        labels = fit_kmeans(X, 2).labels_
        return k_metrics, 2, labels, silhouette(X, labels), None, None, "none"
    labels = fit_kmeans(X, best_k).labels_
    sil = float(k_metrics.loc[k_metrics["k"] == best_k, "silhouette"].values[0])
    null = null_silhouettes(X, best_k)
    stab = stability(X, best_k, labels)
    return k_metrics, best_k, labels, sil, null, stab, structure_verdict(sil, null, stab)


def snapshot(df, labels):
    """Sample visits on two axes that mean the same thing in every analysis (how far down the page, and time on
    the page in log10 seconds), so snapshots from different weeks can be drawn on one chart."""
    depth = df["scroll_depth_reached"].fillna(0).clip(0, 1).to_numpy()
    seconds = np.log10(df["duration_s"].fillna(1).clip(1, 3600).to_numpy())
    rng = np.random.default_rng(RANDOM_SEED)
    idx = rng.choice(len(df), size=min(len(df), SNAPSHOT_POINTS), replace=False)
    points = [[round(float(depth[i]), 3), round(float(seconds[i]), 3), int(labels[i])] for i in sorted(idx)]
    centres = {int(c): [round(float(np.median(depth[labels == c])), 3), round(float(np.median(seconds[labels == c])), 3)] for c in set(labels)}
    return {"points": points, "centres": centres}


def hierarchical_agreement(X, km_labels, k):
    # Ward needs memory that grows with the square of the visits, so busy pages are checked on a sample.
    if len(X) > WARD_SAMPLE:
        idx = np.random.default_rng(RANDOM_SEED).choice(len(X), size=WARD_SAMPLE, replace=False)
        X, km_labels = X[idx], km_labels[idx]
    hc_labels = AgglomerativeClustering(n_clusters=k, linkage="ward").fit_predict(X)
    cost = np.zeros((k, k), dtype=int)
    for i in range(k):
        for j in range(k):
            cost[i, j] = -np.sum((km_labels == i) & (hc_labels == j))
    rows, cols = linear_sum_assignment(cost)
    mapping = {cols[i]: rows[i] for i in range(k)}
    return float((km_labels == np.array([mapping[l] for l in hc_labels])).mean())



def label_desktop_clusters(means):
    # Fallback labels; the server's interpretation names the groups.
    labels_map = {}
    for cl in means.index:
        row = means.loc[cl]
        if row["move_density"] < 0.3 and row["click_rate"] < 0.01:
            name = "Passive / Brief Visitors"
        elif row["click_rate"] > 0.05 and row["move_density"] > 1.0:
            name = "Active Explorers"
        elif row["pause_rate"] > 0.1 and (row["dwell_before_click"] or 0) > 800:
            name = "Focused Readers"
        else:
            name = "General Visitors"
        labels_map[int(cl)] = name
    return labels_map


def label_mobile_clusters(means):
    labels_map = {}
    for cl in means.index:
        row = means.loc[cl]
        if row["tap_rate"] < 0.01 and row["scroll_depth_reached"] < 0.3:
            name = "Passive / Brief Visitors"
        elif row["attention_pause_rate"] > 0.03 and row["avg_attention_pause_ms"] > 2500:
            name = "Focused Readers"
        elif row["tap_rate"] > 0.03 and row["scroll_depth_reached"] > 0.6:
            name = "Active Explorers"
        elif row["direction_change_rate"] > 0.05:
            name = "Revisiting Visitors"
        else:
            name = "General Visitors"
        labels_map[int(cl)] = name
    return labels_map



def goal_counts(hits_column):
    counts = {}
    for hits in hits_column:
        if isinstance(hits, list):
            for goal in set(hits):
                counts[goal] = counts.get(goal, 0) + 1
    return counts


def top_clicks(targets_column, limit=3, min_share=0.1):
    """The targets most visits in a group clicked, each with the share of the group's visits that clicked it."""
    counts, targets, n = {}, {}, 0
    for targets_list in targets_column:
        n += 1
        if isinstance(targets_list, list):
            for t in targets_list:
                key = json.dumps(t, sort_keys=True)
                counts[key] = counts.get(key, 0) + 1
                targets[key] = t
    ranked = sorted(counts.items(), key=lambda kv: -kv[1])[:limit]
    return [{**targets[k], "share": round(c / n, 4)} for k, c in ranked if n and c / n >= min_share]


def json_safe(value):
    # NaN is not valid JSON, and the server parses this output with JSON.parse.
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    if isinstance(value, dict):
        return {k: json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(v) for v in value]
    if isinstance(value, np.generic):
        return json_safe(value.item())
    return value


def run_kruskal_wallis(df, labels, feature_cols):
    """The groups were built from these features, so p-values are small almost by construction; the effect
    size (epsilon squared) says how much a feature actually differs between groups."""
    clusters = sorted(set(labels))
    n = len(labels)
    results = []
    for feat in feature_cols:
        values = df[feat].to_numpy(dtype=float)
        groups = [values[(labels == cl) & ~np.isnan(values)] for cl in clusters]
        groups = [g for g in groups if len(g) > 0]
        h_stat, p_val, effect = float("nan"), float("nan"), float("nan")
        # A wait before clicking can exist in only one group (the others never click), and then there's nothing to compare.
        if len(groups) >= 2:
            try:
                h_stat, p_val = kruskal(*groups)
                effect = h_stat / (sum(len(g) for g in groups) - 1)
            except ValueError:
                pass

        results.append({
            "feature":     feat,
            "H_statistic": round(float(h_stat), 4),
            "p_value":     round(float(p_val), 4),
            "effect_size": round(float(effect), 4),
            "significant": "yes" if effect >= MEDIUM_EFFECT and p_val < 0.05 else "no"
        })
    return pd.DataFrame(results)



def failure(reason, have, needed, message):
    return None, None, None, None, {"reason": reason, "have": have, "needed": needed, "message": message}


def main(device, site_key):
    print(f"\nTraceTray - behavioural clustering ({device})")
    df_raw = load_dataset(DATASET_DIR, site_key, device)
    n_sessions = len(df_raw)
    what = "desktop visits with recorded interaction" if device == "desktop" else "phone visits with scrolling or tapping"

    if n_sessions == 0:
        return failure("no_sessions", 0, MIN_GROUP_SIZE * 2, f"No {what} have been recorded on this page yet.")

    min_size = min_group_size(n_sessions)
    k_range = compute_k_range(n_sessions, min_size)
    if k_range is None:
        needed = min_size * 2
        noun = "desktop visit" if device == "desktop" else "phone visit"
        return failure("insufficient_data", n_sessions, needed,
            f"{n_sessions} {noun}{'' if n_sessions == 1 else 's'} on this page had enough recorded interaction to study. TraceTray needs at least {needed} to sort visitors into groups.")

    if device == "desktop":
        df = engineer_desktop_features(df_raw)
        engineered = DESKTOP_ENGINEERED_FEATURES
    else:
        df = engineer_mobile_features(df_raw)
        engineered = MOBILE_ENGINEERED_FEATURES

    X, used, T = clustering_matrix(df, engineered)
    if X is None:
        return failure("no_variation", n_sessions, n_sessions, "No reliable groups found: the recorded measures don't vary across these visits.")

    goal = json.loads(os.environ.get("TRACETRAY_GOAL") or "null")
    reached = df_raw["goal_hits"].apply(lambda hits: isinstance(hits, list) and goal["id"] in hits).to_numpy()         if goal and "goal_hits" in df_raw.columns else None
    if reached is not None and min(reached.sum(), (~reached).sum()) < goal_model.MIN_EACH_SIDE:
        reached = None
    k_metrics, best_k, km_labels, sil, null, stab, verdict = cluster(X, k_range, min_size, reached)
    print(k_metrics.to_string(index=False))
    small_groups = null is None
    print(f"\nk={best_k} silhouette={sil:.3f} null_max={max(null) if null else '-'} stability={stab} structure={verdict}")

    df["cluster_km"] = km_labels
    cluster_means = df.groupby("cluster_km")[engineered].mean()
    names = label_desktop_clusters(cluster_means) if device == "desktop" else label_mobile_clusters(cluster_means)

    df_out = df[["session_id"] + engineered + ["cluster_km"]].copy()
    df_out["behaviour_label"] = df_out["cluster_km"].map(names)
    for column in ("goal_hits", "click_targets"):
        if column in df_raw.columns:
            df_out[column] = df_raw[column].values

    model = goal_model.fit(df_raw, goal and goal.get("id"), engineer_desktop_features if device == "desktop" else engineer_mobile_features,
                           engineered, clustering_matrix)

    quality = {
        "silhouette": sil,
        "null_silhouette": float(np.mean(null)) if null else None,
        "null_silhouette_max": float(max(null)) if null else None,
        "small_groups": small_groups,
        "stability": stab,
        "structure": verdict,
        "agreement": hierarchical_agreement(X, km_labels, best_k),
        "features_used": used,
        "min_group_size": min_size,
        "spread": dict(zip(used, T.std(axis=0).round(4).tolist())),
        "centres": {int(c): dict(zip(used, T[km_labels == c].mean(axis=0).round(4).tolist())) for c in set(km_labels)},
        "snapshot": snapshot(df, km_labels),
        "goal_model": model,
        "goal_informed_k": reached is not None
    }
    return df_out, km_labels, cluster_means, k_metrics, quality


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--json-summary", action="store_true",
                        help="emit a TRACETRAY_RESULT: {...} line for the dashboard API")
    parser.add_argument("--device", choices=["desktop", "mobile"], default="desktop",
                        help="which device type's sessions to analyze")
    args = parser.parse_args()

    site_key = os.environ.get("TRACETRAY_SITE_KEY", "unknown")
    meta = load_meta(DATASET_DIR, site_key, args.device)

    df_out, km_labels, cluster_means, k_metrics, info = main(args.device, site_key)

    if args.json_summary:
        visits = {"visit_count": meta.get("visits"), "inactive_count": meta.get("inactive"), "inactive_goal_hits": meta.get("inactive_goal_hits") or {}, "scope": meta.get("scope")}
        if df_out is None:
            info = info or {"reason": "unknown", "message": "Clustering could not be completed."}
            print(f"TRACETRAY_RESULT: {json.dumps(json_safe({'session_count': info.get('have', 0), 'k': 0, 'silhouette_score': None, 'clusters': [], 'kruskal_wallis': [], 'k_rationale': {}, 'device': args.device, 'failure': info, **visits}), allow_nan=False)}")
            sys.exit(0)

        engineered = DESKTOP_ENGINEERED_FEATURES if args.device == "desktop" else MOBILE_ENGINEERED_FEATURES

        clusters_out = []
        for cl_id, label in df_out.groupby("cluster_km")["behaviour_label"].first().to_dict().items():
            members = df_out["cluster_km"] == cl_id
            clusters_out.append({
                "id":            int(cl_id),
                "label":         label,
                "n":             int(members.sum()),
                "feature_means": cluster_means.loc[cl_id].round(4).to_dict(),
                "goal_hits":     goal_counts(df_out.loc[members, "goal_hits"]) if "goal_hits" in df_out.columns else {},
                "top_clicks":    top_clicks(df_out.loc[members, "click_targets"]) if "click_targets" in df_out.columns else [],
                "centre":        info["centres"].get(int(cl_id), {})
            })

        best_k = int(df_out["cluster_km"].nunique())
        kw_df = run_kruskal_wallis(df_out, km_labels, engineered)

        summary = {
            "device":              args.device,
            "session_count":       int(len(df_out)),
            "k":                   best_k,
            "silhouette_score":    info["silhouette"],
            "algorithm_agreement": info["agreement"],
            "structure":           info["structure"],
            "stability":           info["stability"],
            "clusters":            clusters_out,
            "kruskal_wallis":      kw_df.to_dict(orient="records"),
            "spread":              info["spread"],
            "snapshot":            info["snapshot"],
            "goal_model":          info["goal_model"],
            "k_rationale": {
                "n_sessions":          int(len(df_out)),
                "min_cluster_size":    info["min_group_size"],
                "k_range_evaluated":   [int(k) for k in k_metrics["k"]],
                "silhouettes":         [round(float(s), 4) for s in k_metrics["silhouette"]],
                "best_k":              best_k,
                "null_silhouette":     info["null_silhouette"],
                "null_silhouette_max": info["null_silhouette_max"],
                "small_groups":        info["small_groups"],
                "features_used":       info["features_used"],
                "goal_informed":       info["goal_informed_k"],
                "selection_basis":     f"smallest k within {SILHOUETTE_TOLERANCE} of the best silhouette, at most {MAX_GROUPS} groups of at least {info['min_group_size']} visits"
            },
            **visits
        }

        print(f"TRACETRAY_RESULT: {json.dumps(json_safe(summary), allow_nan=False)}")
