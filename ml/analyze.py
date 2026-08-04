# Clusters desktop and mobile interaction features separately.

import json
import glob
import os
import sys
import argparse
import warnings

import numpy as np
import pandas as pd

from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans, AgglomerativeClustering
from sklearn.metrics import silhouette_score, davies_bouldin_score, calinski_harabasz_score
from scipy.stats import kruskal
from scipy.optimize import linear_sum_assignment

warnings.filterwarnings("ignore")



DATASET_DIR = "../data/features"
RANDOM_SEED = 42

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



def load_dataset(dataset_dir, site_key, device):
    path = os.path.join(dataset_dir, f"dataset_{site_key}_{device}.json")
    if not os.path.exists(path):
        print(f"no dataset found at {path}")
        sys.exit(1)

    with open(path) as f:
        data = json.load(f)

    print(f"  loaded {len(data)} {device} sessions from {os.path.basename(path)}")
    df = pd.DataFrame(data)
    return df



def engineer_desktop_features(df):
    # Normalize count features by session duration.
    df = df.copy()
    df["duration_s"] = df["duration_ms"] / 1000
    df["duration_s"] = df["duration_s"].replace(0, np.nan)

    df["pause_rate"]   = df["cursor_pauses"] / df["duration_s"]
    df["click_rate"]   = df["clicks"]        / df["duration_s"]
    df["move_density"] = df["mouse_moves"]   / df["duration_s"]

    df["distance_per_move"] = df.apply(
        lambda r: r["total_cursor_distance"] / r["mouse_moves"]
        if r["mouse_moves"] > 0 else 0, axis=1
    )
    df["direction_change_rate"] = df["scroll_direction_changes"] / df["duration_s"]
    df["scroll_burst_rate"] = df["scroll_bursts"] / df["duration_s"]

    # Convert cursor grid counts to proportions.
    grid_cols = [f"grid_{r}_{c}" for r in range(3) for c in range(3)]
    df["grid_total"] = df[grid_cols].sum(axis=1).replace(0, np.nan)
    for col in grid_cols:
        df[col + "_norm"] = df[col] / df["grid_total"]

    df["top_zone_ratio"]    = df[["grid_0_0_norm", "grid_0_1_norm", "grid_0_2_norm"]].mean(axis=1)
    df["centre_zone_ratio"] = df[["grid_1_0_norm", "grid_1_1_norm", "grid_1_2_norm"]].mean(axis=1)
    df["bottom_zone_ratio"] = df[["grid_2_0_norm", "grid_2_1_norm", "grid_2_2_norm"]].mean(axis=1)

    def grid_entropy(row):
        vals = np.array([row[c + "_norm"] for c in grid_cols], dtype=float)
        vals = vals[~np.isnan(vals)]
        vals = vals[vals > 0]
        if len(vals) == 0:
            return 0.0
        return float(-np.sum(vals * np.log2(vals)))

    df["spatial_entropy"] = df.apply(grid_entropy, axis=1)

    df = df.fillna(0)
    return df


def engineer_mobile_features(df):
    # Normalize count features by session duration.
    df = df.copy()
    df["duration_s"] = df["duration_ms"] / 1000
    df["duration_s"] = df["duration_s"].replace(0, np.nan)

    df["scroll_velocity_rate"] = df["scroll_velocity"]
    df["direction_change_rate"] = df["scroll_direction_changes"] / df["duration_s"]
    df["scroll_burst_rate"] = df["scroll_bursts"] / df["duration_s"]

    df = df.fillna(0)
    return df



def compute_k_range(n_sessions, min_cluster_size=8, absolute_max=8):
    """
    derive a viable k range from dataset size.
    no cluster should have fewer than min_cluster_size sessions.
    capped at absolute_max for usability, more than 8 visitor types is not
    useful while the interpretation layer handles more detail within each group.

    returns None if there are not enough sessions to form even two clusters
    of min_cluster_size each. forcing k=2 on a tiny dataset produces a
    statistically meaningless split, so this is treated as a clear failure
    rather than silently returning a low-quality result
    """
    if n_sessions < min_cluster_size * 2:
        return None
    max_viable_k = n_sessions // min_cluster_size
    max_k = min(max_viable_k, absolute_max)
    return range(2, max_k + 1)


def select_k(X_scaled, k_range=range(2, 7)):
    rows = []
    for k in k_range:
        km = KMeans(n_clusters=k, random_state=RANDOM_SEED, n_init=20)
        labels = km.fit_predict(X_scaled)

        sil = silhouette_score(X_scaled, labels)
        db  = davies_bouldin_score(X_scaled, labels)
        ch  = calinski_harabasz_score(X_scaled, labels)
        sse = km.inertia_

        rows.append({"k": k, "silhouette": sil, "davies_bouldin": db,
                     "calinski_harabasz": ch, "inertia": sse})

    return pd.DataFrame(rows)



def run_kmeans(X_scaled, k):
    km = KMeans(n_clusters=k, random_state=RANDOM_SEED, n_init=20)
    labels = km.fit_predict(X_scaled)

    sil = silhouette_score(X_scaled, labels)
    db  = davies_bouldin_score(X_scaled, labels)
    print(f"  kmeans (k={k})  silhouette={sil:.4f}  davies-bouldin={db:.4f}")

    return labels, km


def run_hierarchical(X_scaled, k):
    hc = AgglomerativeClustering(n_clusters=k, linkage="ward")
    labels = hc.fit_predict(X_scaled)

    sil = silhouette_score(X_scaled, labels)
    print(f"  hierarchical (k={k})  silhouette={sil:.4f}")

    return labels



def print_cluster_summary(df, labels, feature_cols):
    df = df.copy()
    df["cluster"] = labels
    cluster_means = df.groupby("cluster")[feature_cols].mean()
    print("\ncluster means:")
    print(cluster_means.round(3).to_string())
    return cluster_means


def label_desktop_clusters(df, labels):
    # Fallback labels based on cluster feature means.
    df = df.copy()
    df["cluster"] = labels
    means = df.groupby("cluster")[DESKTOP_ENGINEERED_FEATURES].mean()

    labels_map = {}
    for cl in means.index:
        row = means.loc[cl]
        if row["move_density"] < 0.3 and row["click_rate"] < 0.01:
            name = "Passive / Brief Visitors"
        elif row["click_rate"] > 0.05 and row["move_density"] > 1.0:
            name = "Active Explorers"
        elif row["pause_rate"] > 0.1 and row["dwell_before_click"] > 800:
            name = "Focused Readers"
        else:
            name = "General Visitors"
        labels_map[int(cl)] = name

    return labels_map


def label_mobile_clusters(df, labels):
    # Mobile fallback labels use touch and scroll features.
    df = df.copy()
    df["cluster"] = labels
    means = df.groupby("cluster")[MOBILE_ENGINEERED_FEATURES].mean()

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



def run_kruskal_wallis(df, labels, feature_cols):
    df = df.copy()
    df["cluster"] = labels
    clusters = sorted(df["cluster"].unique())

    results = []
    for feat in feature_cols:
        groups = [df[df["cluster"] == cl][feat].values for cl in clusters]
        try:
            h_stat, p_val = kruskal(*groups)
        except ValueError:
            h_stat, p_val = float("nan"), float("nan")

        results.append({
            "feature":     feat,
            "H_statistic": round(h_stat, 4),
            "p_value":     round(p_val, 4),
            "significant": "yes" if p_val < 0.05 else "no"
        })

    kw_df = pd.DataFrame(results)
    print("\nkruskal-wallis results:")
    print(kw_df.to_string(index=False))
    return kw_df



def main(device, site_key):
    print(f"\nTraceTray - behavioural clustering ({device})")
    print("=" * 40)

    print("\nloading data...")
    df_raw = load_dataset(DATASET_DIR, site_key, device)

    if len(df_raw) == 0:
        print(f"no {device} sessions available for this site")
        return None, None, None, None, {
            "reason":  "no_sessions",
            "have":    0,
            "needed":  16,
            "message": f"No {device} sessions have been collected for this page yet."
        }

    MIN_CLUSTER_SIZE = 8
    n_sessions = len(df_raw)
    k_range = compute_k_range(n_sessions, min_cluster_size=MIN_CLUSTER_SIZE)

    if k_range is None:
        needed = MIN_CLUSTER_SIZE * 2
        print(f"\nnot enough sessions to cluster: have {n_sessions}, need at least {needed} "
              f"(minimum {MIN_CLUSTER_SIZE} per cluster, at least 2 clusters)")
        return None, None, None, None, {
            "reason":   "insufficient_data",
            "have":     n_sessions,
            "needed":   needed,
            "message":  f"Only {n_sessions} sessions collected so far. At least {needed} are needed before visitor types can be reliably identified."
        }

    print("engineering features...")
    if device == "desktop":
        df = engineer_desktop_features(df_raw)
        engineered = DESKTOP_ENGINEERED_FEATURES
    else:
        df = engineer_mobile_features(df_raw)
        engineered = MOBILE_ENGINEERED_FEATURES

    X = df[engineered].fillna(0)
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    print(f"\nselecting k (n={n_sessions}, min_cluster_size={MIN_CLUSTER_SIZE}, k_range={list(k_range)})...")

    k_metrics = select_k(X_scaled, k_range=k_range)
    print(k_metrics.to_string(index=False))

    best_k = int(k_metrics.loc[k_metrics["silhouette"].idxmax(), "k"])
    print(f"\nusing k = {best_k}")

    print(f"\nclustering (k={best_k})...")
    km_labels, km_model = run_kmeans(X_scaled, best_k)
    hc_labels           = run_hierarchical(X_scaled, best_k)

    cost_matrix = np.zeros((best_k, best_k), dtype=int)
    for i in range(best_k):
        for j in range(best_k):
            cost_matrix[i, j] = -np.sum((km_labels == i) & (hc_labels == j))
    row_ind, col_ind = linear_sum_assignment(cost_matrix)
    label_map          = {col_ind[i]: row_ind[i] for i in range(best_k)}
    hc_labels_aligned  = np.array([label_map[l] for l in hc_labels])
    agreement          = (km_labels == hc_labels_aligned).mean()
    print(f"  kmeans / hierarchical agreement: {agreement*100:.1f}%")

    df["cluster_km"] = km_labels

    cluster_means = print_cluster_summary(df, km_labels, engineered)
    behaviour_names = (
        label_desktop_clusters(df, km_labels) if device == "desktop"
        else label_mobile_clusters(df, km_labels)
    )

    print("behavioural labels:")
    for cl, name in behaviour_names.items():
        n = (km_labels == cl).sum()
        print(f"  cluster {cl}: {name}  (n={n})")

    print("\nrunning kruskal-wallis tests...")
    kw_results = run_kruskal_wallis(df, km_labels, engineered)

    df_out = df[["session_id"] + engineered + ["cluster_km"]].copy()
    df_out["behaviour_label"] = df_out["cluster_km"].map(behaviour_names)

    return df_out, km_labels, cluster_means, k_metrics, None


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--json-summary", action="store_true",
                        help="emit a TRACETRAY_RESULT: {...} line for the dashboard API")
    parser.add_argument("--device", choices=["desktop", "mobile"], default="desktop",
                        help="which device type's sessions to analyse")
    args = parser.parse_args()

    site_key = os.environ.get("TRACETRAY_SITE_KEY", "unknown")

    df_out, km_labels, cluster_means, k_metrics, failure_info = main(args.device, site_key)

    if args.json_summary:
        if df_out is None:
            info = failure_info or {"reason": "unknown", "message": "Clustering could not be completed."}
            print(f"TRACETRAY_RESULT: {json.dumps({'session_count': info.get('have', 0), 'k': 0, 'silhouette_score': None, 'clusters': [], 'kruskal_wallis': [], 'k_rationale': {}, 'device': args.device, 'failure': info})}")
            sys.exit(0)

        engineered = DESKTOP_ENGINEERED_FEATURES if args.device == "desktop" else MOBILE_ENGINEERED_FEATURES

        behaviour_names_map = df_out.groupby("cluster_km")["behaviour_label"].first().to_dict()

        clusters_out = []
        for cl_id, label in behaviour_names_map.items():
            n         = int((df_out["cluster_km"] == cl_id).sum())
            means_row = cluster_means.loc[cl_id].round(4).to_dict() if cl_id in cluster_means.index else {}
            clusters_out.append({
                "id":            int(cl_id),
                "label":         label,
                "n":             n,
                "feature_means": means_row
            })

        best_k        = int(df_out["cluster_km"].nunique())
        session_count = int(len(df_out))
        sil           = float(k_metrics.loc[k_metrics["k"] == best_k, "silhouette"].values[0]) \
                        if best_k in k_metrics["k"].values else None

        kw_df  = run_kruskal_wallis(df_out, km_labels, engineered)
        kw_out = kw_df.to_dict(orient="records")

        k_rationale = {
            "n_sessions":        session_count,
            "min_cluster_size":  8,
            "k_range_evaluated": list(k_metrics["k"].astype(int)),
            "best_k":            best_k,
            "selection_basis":   "silhouette score maximised within viable k range"
        }

        summary = {
            "device":              args.device,
            "session_count":       session_count,
            "k":                   best_k,
            "silhouette_score":    sil,
            "algorithm_agreement": None,
            "clusters":            clusters_out,
            "kruskal_wallis":      kw_out,
            "k_rationale":         k_rationale
        }

        print(f"TRACETRAY_RESULT: {json.dumps(summary)}")
