# Clusters desktop and mobile interaction features separately.

import json
import math
import os
import sys
import argparse
import warnings

import numpy as np
import pandas as pd

from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans, AgglomerativeClustering
from sklearn.metrics import silhouette_score, davies_bouldin_score, calinski_harabasz_score, adjusted_rand_score
from scipy.stats import kruskal
from scipy.optimize import linear_sum_assignment

warnings.filterwarnings("ignore")



DATASET_DIR = "../data/features"
RANDOM_SEED = 42

# More groups than this stop being something a site owner can act on.
MAX_GROUPS = 5
MIN_GROUP_SIZE = 8
# A smaller k wins unless a larger one separates visitors clearly better.
SILHOUETTE_TOLERANCE = 0.02
NULL_REPS = 10
STABILITY_REPS = 10
SILHOUETTE_SAMPLE = 2000
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
        if col not in ONLY_WHEN_ACTED:
            df[col] = df[col].replace([np.inf, -np.inf], np.nan).fillna(0)
    return df


def clustering_matrix(df, features):
    """Log-scales skewed features, fills waits for visits that never acted with the median wait, standardizes,
    clips outliers and drops features that don't vary. Returns the matrix and the features it kept."""
    cols, kept = [], []
    for feat in features:
        if feat in CLUSTER_EXCLUDED:
            continue
        values = df[feat].astype(float)
        if feat in ONLY_WHEN_ACTED:
            values = values.fillna(values.median() if values.notna().any() else 0)
        values = values.clip(lower=0)
        if feat not in UNSKEWED:
            values = np.log1p(values)
        if values.std() < 1e-9:
            continue
        cols.append(values.to_numpy())
        kept.append(feat)
    if not cols:
        return None, []
    X = StandardScaler().fit_transform(np.column_stack(cols))
    return np.clip(X, -4, 4), kept



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


def select_k(X, k_range, min_size):
    rows = []
    for k in k_range:
        km = fit_kmeans(X, k)
        sizes = np.bincount(km.labels_, minlength=k)
        rows.append({
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


def hierarchical_agreement(X, km_labels, k):
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
    what = "desktop visits with cursor movement" if device == "desktop" else "phone visits with scrolling or tapping"

    if n_sessions == 0:
        return failure("no_sessions", 0, MIN_GROUP_SIZE * 2, f"No {what} have been recorded on this page yet.")

    min_size = min_group_size(n_sessions)
    k_range = compute_k_range(n_sessions, min_size)
    if k_range is None:
        needed = min_size * 2
        noun = "desktop visit" if device == "desktop" else "phone visit"
        return failure("insufficient_data", n_sessions, needed,
            f"{n_sessions} {noun}{'' if n_sessions == 1 else 's'} on this page had enough {'cursor movement' if device == 'desktop' else 'scrolling or tapping'} to study. TraceTray needs at least {needed} to sort visitors into groups.")

    if device == "desktop":
        df = engineer_desktop_features(df_raw)
        engineered = DESKTOP_ENGINEERED_FEATURES
    else:
        df = engineer_mobile_features(df_raw)
        engineered = MOBILE_ENGINEERED_FEATURES

    X, used = clustering_matrix(df, engineered)
    if X is None:
        return failure("no_variation", n_sessions, n_sessions, f"Every {what.split(' with ')[0][:-1]} on this page behaved the same way, so there are no groups to find.")

    k_metrics, best_k = select_k(X, k_range, min_size)
    print(k_metrics.to_string(index=False))

    if best_k is None:
        # Every split leaves a group too small to describe: a few unusual visits, not real groups.
        best_k = 2
        km_labels = fit_kmeans(X, 2).labels_
        sil, null, stab = silhouette(X, km_labels), [1.0], 0.0
    else:
        km_labels = fit_kmeans(X, best_k).labels_
        sil = float(k_metrics.loc[k_metrics["k"] == best_k, "silhouette"].values[0])
        null = null_silhouettes(X, best_k)
        stab = stability(X, best_k, km_labels)

    verdict = structure_verdict(sil, null, stab)
    print(f"\nk={best_k} silhouette={sil:.3f} null_max={max(null):.3f} stability={stab:.3f} structure={verdict}")

    df["cluster_km"] = km_labels
    cluster_means = df.groupby("cluster_km")[engineered].mean()
    names = label_desktop_clusters(cluster_means) if device == "desktop" else label_mobile_clusters(cluster_means)

    df_out = df[["session_id"] + engineered + ["cluster_km"]].copy()
    df_out["behaviour_label"] = df_out["cluster_km"].map(names)
    if "goal_hits" in df_raw.columns:
        df_out["goal_hits"] = df_raw["goal_hits"].values

    quality = {
        "silhouette": sil,
        "null_silhouette": float(np.mean(null)),
        "null_silhouette_max": float(max(null)),
        "stability": stab,
        "structure": verdict,
        "agreement": hierarchical_agreement(X, km_labels, best_k),
        "features_used": used,
        "min_group_size": min_size
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
        visits = {"visit_count": meta.get("visits"), "inactive_count": meta.get("inactive"), "inactive_goal_hits": meta.get("inactive_goal_hits") or {}}
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
                "goal_hits":     goal_counts(df_out.loc[members, "goal_hits"]) if "goal_hits" in df_out.columns else {}
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
            "k_rationale": {
                "n_sessions":          int(len(df_out)),
                "min_cluster_size":    info["min_group_size"],
                "k_range_evaluated":   [int(k) for k in k_metrics["k"]],
                "silhouettes":         [round(float(s), 4) for s in k_metrics["silhouette"]],
                "best_k":              best_k,
                "null_silhouette":     info["null_silhouette"],
                "null_silhouette_max": info["null_silhouette_max"],
                "features_used":       info["features_used"],
                "selection_basis":     f"smallest k within {SILHOUETTE_TOLERANCE} of the best silhouette, at most {MAX_GROUPS} groups of at least {info['min_group_size']} visits"
            },
            **visits
        }

        print(f"TRACETRAY_RESULT: {json.dumps(json_safe(summary), allow_nan=False)}")
