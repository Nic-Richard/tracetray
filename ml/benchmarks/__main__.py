import argparse
import json
from pathlib import Path
import platform
import subprocess
import sys

import numpy as np
import pandas as pd
import sklearn
from scipy.optimize import linear_sum_assignment
from sklearn.metrics import adjusted_rand_score

import analyze
import goal_model
from .data import continuous_measures, desktop_visits, goal_visits, planted_visits


def fit_goal(frame, device="desktop"):
    engineer, features = (analyze.engineer_desktop_features, analyze.DESKTOP_ENGINEERED_FEATURES) if device == "desktop" else (analyze.engineer_mobile_features, analyze.MOBILE_ENGINEERED_FEATURES)
    return goal_model.fit(frame, "g", engineer, features,
                          fill_features=analyze.FILL_TYPICAL, unskewed=analyze.UNSKEWED, excluded=analyze.CLUSTER_EXCLUDED)


def cluster_frame(frame, truth=None, reached=None, fill_seed=42, engineered=False):
    measures = frame if engineered else analyze.engineer_desktop_features(frame)
    features = list(frame.columns) if engineered else analyze.DESKTOP_ENGINEERED_FEATURES
    X, used, transformed = analyze.clustering_matrix(measures, features, fill_seed=fill_seed)
    size = analyze.min_group_size(len(frame))
    _, k, labels, sil, _, stability, verdict = analyze.cluster(X, analyze.compute_k_range(len(frame), size), size, reached)
    snapshot = {"spread": dict(zip(used, transformed.std(axis=0).tolist())), "clusters": []}
    for group in sorted(set(labels)):
        mask = labels == group
        snapshot["clusters"].append({"id": int(group), "n": int(mask.sum()),
            "centre": dict(zip(used, transformed[mask].mean(axis=0).tolist())),
            "truth": int(np.bincount(truth[mask]).argmax()) if truth is not None else None})
    return {"k": k, "structure": verdict, "silhouette": round(sil, 4), "stability": round(stability, 4) if stability is not None else None,
            "labels": labels, "snapshot": snapshot}


def finding(result):
    return result["status"] == "ok" and bool(result.get("drivers"))


def summary(values):
    return {"min": round(float(np.min(values)), 4), "mean": round(float(np.mean(values)), 4), "max": round(float(np.max(values)), 4)}


def shuffle_case(seeds, n):
    findings, aucs = [], []
    for seed in range(seeds):
        for device in ("desktop", "mobile"):
            frame = goal_visits(seed, n, signal=3, device=device)
            order = np.random.default_rng(seed + 10000).permutation(len(frame))
            frame["goal_hits"] = frame["goal_hits"].iloc[order].tolist()
            result = fit_goal(frame, device)
            if finding(result):
                findings.append({"seed": seed, "device": device})
            aucs.append(result.get("auc", 0.5))
        if (seed + 1) % 20 == 0:
            print(f"Shuffled labels: {seed + 1}/{seeds}", file=sys.stderr, flush=True)
    return {"passed": not findings, "runs": seeds * 2, "seeds_per_device": seeds, "false_findings": len(findings), "false_finding_rate": len(findings) / (seeds * 2),
            "failing_seeds": findings, "auc": summary(aucs)}


def goals_case(seeds, n):
    whole_aucs, window_aucs = [], []
    false_findings, recovered, empty_findings = [], [], []
    for seed in range(seeds):
        for device in ("desktop", "mobile"):
            frame = goal_visits(seed + 100, n, after_goal=True, device=device)
            windowed = fit_goal(frame, device)
            whole = fit_goal(frame.drop(columns="windows"), device)
            empty = frame.copy()
            empty["windows"] = [{} for _ in range(n)]
            empty_result = fit_goal(empty, device)
            whole_aucs.append(whole.get("auc", 0.5))
            window_aucs.append(windowed.get("auc", 0.5))
            if finding(windowed):
                false_findings.append({"seed": seed, "device": device})
            if finding(empty_result):
                empty_findings.append({"seed": seed, "device": device})
            planted = fit_goal(goal_visits(seed + 200, n, signal=3, device=device), device)
            recovered.append(any(d["feature"] == "scroll_depth_reached" and d["direction"] == "higher" for d in planted.get("drivers", [])) and finding(planted))
    runs = seeds * 2
    return {
        "whole_vs_windows": {"passed": min(whole_aucs) > 0.8 and max(window_aucs) < 0.65,
            "runs": runs, "whole_auc": summary(whole_aucs), "window_auc": summary(window_aucs)},
        "after_conversion_only": {"passed": not false_findings, "runs": runs, "false_findings": len(false_findings),
            "false_finding_rate": len(false_findings) / runs, "failing_seeds": false_findings},
        "empty_pre_goal_windows": {"passed": not empty_findings, "runs": runs, "false_findings": len(empty_findings),
            "false_finding_rate": len(empty_findings) / runs, "failing_seeds": empty_findings},
        "known_pre_goal_signal": {"passed": all(recovered), "runs": runs, "recovered_with_right_direction": sum(recovered), "recovery_rate": sum(recovered) / runs}
    }


def switch_rate(first, second):
    counts = pd.crosstab(first, second)
    rows, columns = linear_sum_assignment(-counts.to_numpy())
    mapping = {counts.columns[c]: counts.index[r] for r, c in zip(rows, columns)}
    changed = np.array([mapping.get(b, -1) != a for a, b in zip(first, second)])
    return changed


def groups_case(seeds, n, fill_seeds):
    aris, without_goal, no_groups, continuous, switches, missing_switches, fill_aris = [], [], [], [], [], [], []
    overlapping_personas, forced_personas = [], []
    independent, overlapping = [], []
    for seed in range(seeds):
        frame, truth = planted_visits(seed + 300, n)
        reached = np.random.default_rng(seed + 400).random(n) < np.array([0.9, 0.1, 0.5])[truth]
        plain = cluster_frame(frame, truth)
        planted = cluster_frame(frame, truth, reached)
        aris.append(adjusted_rand_score(truth, planted["labels"]))
        without_goal.append(adjusted_rand_score(truth, plain["labels"]))
        ambiguous, ambiguous_truth = desktop_visits(np.random.default_rng(seed + 300), n, scroll_only=0.15)
        ambiguous_result = cluster_frame(ambiguous, ambiguous_truth)
        overlapping_personas.append(adjusted_rand_score(ambiguous_truth, ambiguous_result["labels"]))
        ambiguous_X, _, _ = analyze.clustering_matrix(analyze.engineer_desktop_features(ambiguous), analyze.DESKTOP_ENGINEERED_FEATURES)
        forced_personas.append(adjusted_rand_score(ambiguous_truth, analyze.fit_kmeans(ambiguous_X, 3).labels_))
        empty, _ = desktop_visits(np.random.default_rng(seed + 500), n, [(1, 0.03, 40, 0.5, 0.5)], scroll_only=0.2)
        no_groups.append(cluster_frame(empty, reached=np.random.default_rng(seed).random(n) < 0.5)["structure"])
        continuous.append(cluster_frame(continuous_measures(seed + 600, n), engineered=True)["structure"])

        first, first_truth = planted_visits(seed + 700, n, scroll_only=0.15)
        second, second_truth = planted_visits(seed + 800, n, scroll_only=0.15)
        a, b = cluster_frame(first, first_truth), cluster_frame(second, second_truth)
        independent.append({"before": a["snapshot"], "after": b["snapshot"]})
        pool, pool_truth = planted_visits(seed + 900, n * 2, scroll_only=0.15)
        a = cluster_frame(pool.iloc[:n], pool_truth[:n])
        b = cluster_frame(pool.iloc[n // 2:n + n // 2], pool_truth[n // 2:n + n // 2])
        overlapping.append({"before": a["snapshot"], "after": b["snapshot"]})

        frame = ambiguous
        plain = ambiguous_result
        measures = analyze.engineer_desktop_features(frame)
        missing = measures[[f for f in analyze.FILL_TYPICAL if f in measures]].isna().any(axis=1).to_numpy()
        for fill_seed in range(fill_seeds):
            other = cluster_frame(frame, fill_seed=fill_seed)
            changed = switch_rate(plain["labels"], other["labels"])
            switches.append(changed.mean())
            missing_switches.append(changed[missing].mean() if missing.any() else 0)
            fill_aris.append(adjusted_rand_score(plain["labels"], other["labels"]))
        print(f"Grouping datasets: {seed + 1}/{seeds}", file=sys.stderr, flush=True)

    tracking = subprocess.run(["node", str(Path(__file__).with_name("tracking.cjs"))], input=json.dumps(independent + overlapping),
                              text=True, capture_output=True, check=True)
    tracked = json.loads(tracking.stdout)

    def tracking_summary(rows):
        groups = sum(r["groups"] for r in rows)
        new = sum(r["new_groups"] for r in rows)
        wrong = sum(r["wrong_matches"] for r in rows)
        return {"passed": new == 0 and wrong == 0, "runs": len(rows), "groups": groups, "new_groups": new,
                "false_new_rate": new / groups, "wrong_matches": wrong, "wrong_match_rate": wrong / groups}

    return {
        "three_planted_groups": {"passed": min(aris) >= 0.8, "runs": seeds, "ari": summary(aris), "ari_without_goal": summary(without_goal)},
        "overlapping_personas": {"diagnostic_only": True, "runs": seeds, "ari": summary(overlapping_personas), "ari_when_forced_to_three": summary(forced_personas)},
        "no_real_groups": {"passed": all(v == "none" for v in no_groups), "runs": seeds,
            "false_group_rate": sum(v != "none" for v in no_groups) / seeds, "confident_group_rate": no_groups.count("clear") / seeds, "verdicts": no_groups},
        "gradual_behaviour": {"passed": "clear" not in continuous, "runs": seeds,
            "confident_group_rate": continuous.count("clear") / seeds, "verdicts": continuous},
        "tracking_independent": tracking_summary(tracked[:seeds]),
        "tracking_overlapping": tracking_summary(tracked[seeds:]),
        "missing_value_seeds": {"passed": float(np.mean(fill_aris)) >= 0.8 and float(np.mean(switches)) <= 0.1,
            "datasets": seeds, "fill_seeds_per_dataset": fill_seeds, "ari": summary(fill_aris),
            "switched_share": summary(switches), "switched_share_among_missing": summary(missing_switches)}
    }


def main():
    parser = argparse.ArgumentParser(description="Run repeatable synthetic ML benchmarks without a database or paid APIs.")
    parser.add_argument("--fast", action="store_true")
    parser.add_argument("--seeds", type=int)
    parser.add_argument("--shuffle-seeds", type=int)
    parser.add_argument("--output")
    args = parser.parse_args()
    seeds = args.seeds or (3 if args.fast else 10)
    shuffle_seeds = args.shuffle_seeds or (4 if args.fast else 200)
    if seeds < 1 or shuffle_seeds < 1:
        parser.error("seed counts must be positive")
    n = 400 if args.fast else 800
    results = {"shuffled_labels": shuffle_case(shuffle_seeds, n)}
    results.update(goals_case(seeds, n))
    results.update(groups_case(seeds, n, 2 if args.fast else 5))
    report = {"mode": "fast" if args.fast else "full", "visits_per_dataset": n,
        "versions": {"python": platform.python_version(), "numpy": np.__version__, "sklearn": sklearn.__version__},
        "passed": all(case.get("passed", True) for case in results.values()), "cases": results}
    output = json.dumps(report, indent=2) + "\n"
    if args.output:
        Path(args.output).write_text(output, encoding="utf-8")
    print(output)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
