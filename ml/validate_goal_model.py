"""Compare full-dataset preprocessing with fold-local preprocessing on the same visits and folds."""
import argparse
import json

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import StratifiedKFold

import analyze
import goal_model


def compare(rows, goal_id, device):
    engineer, features = (analyze.engineer_desktop_features, analyze.DESKTOP_ENGINEERED_FEATURES) if device == "desktop" else (analyze.engineer_mobile_features, analyze.MOBILE_ENGINEERED_FEATURES)
    windowed = "windows" in rows and rows["windows"].apply(lambda w: isinstance(w, dict) and bool(w)).any()
    if windowed:
        frame, y, window, _ = goal_model.matched_windows(rows, goal_id)
    else:
        (frame, y), window = goal_model.whole_visits(rows, goal_id), None
    if min(int(y.sum()), int((~y).sum())) < goal_model.MIN_EACH_SIDE:
        return {"status": "too_few", "window_s": window}
    X, _, _ = analyze.clustering_matrix(engineer(frame), features)
    if X is None:
        return {"status": "no_variation", "window_s": window}
    scores = []
    for train, test in StratifiedKFold(goal_model.FOLDS, shuffle=True, random_state=goal_model.RANDOM_SEED).split(X, y):
        model = LogisticRegression(C=0.5, class_weight="balanced", max_iter=2000).fit(X[train], y[train])
        scores.append(roc_auc_score(y[test], model.predict_proba(X[test])[:, 1]))
    current = goal_model.fit(rows, goal_id, engineer, features, fill_features=analyze.FILL_TYPICAL,
                             unskewed=analyze.UNSKEWED, excluded=analyze.CLUSTER_EXCLUDED)
    return {"device": device, "visits": len(frame), "window_s": window, "before_auc": round(float(np.mean(scores)), 4),
            "after_auc": current.get("auc"), "auc_change": round(current["auc"] - float(np.mean(scores)), 4) if "auc" in current else None,
            "later_visits": current.get("later_visits"), "status": current["status"], "drivers": current.get("drivers", [])}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset")
    parser.add_argument("goal")
    parser.add_argument("--device", choices=("desktop", "mobile"), default="desktop")
    args = parser.parse_args()
    with open(args.dataset, encoding="utf-8") as dataset:
        rows = pd.DataFrame(json.load(dataset))
    print(json.dumps(compare(rows, args.goal, args.device), indent=2))
