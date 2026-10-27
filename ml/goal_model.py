"""What separates visits that reached the page's goal from those that didn't.

A regularized logistic regression on behaviour over the same first seconds of every visit, before the goal. It only reports when cross-validation shows
it clearly beats chance, and then names the measures that point the same way in every fold. These are associations,
not causes.
"""
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import StratifiedKFold

RANDOM_SEED = 42
MIN_EACH_SIDE = 40
FOLDS = 5
MIN_AUC = 0.65
MAX_DRIVERS = 3
MIN_WEIGHT = 0.25
MIN_GAP = 0.08


def matched_windows(df_raw, goal_id):
    """Every visit measured over the same first seconds, so neither side is watched for longer. The window is the
    longest that keeps at least half as many visits on the smaller side as the best window would; longer windows hold
    more behaviour, but fewer visits last that long without converting first. It's chosen from counts alone. Returns
    the rows, the labels, the window and how many visits reached the goal before it ended."""
    reached = df_raw["goal_hits"].apply(lambda hits: isinstance(hits, list) and goal_id in hits).to_numpy()
    windows = df_raw["windows"].apply(lambda w: {int(k): v for k, v in w.items()} if isinstance(w, dict) else {}).tolist()
    lengths = sorted({s for w in windows for s in w})
    if not lengths:
        return pd.DataFrame(), np.array([], dtype=bool), None, int(reached.sum())
    def balance(length):
        has = np.array([length in w for w in windows])
        return min((has & reached).sum(), (has & ~reached).sum())
    best = max(balance(s) for s in lengths)
    length = max(s for s in lengths if balance(s) >= best / 2)
    keep = [i for i, w in enumerate(windows) if length in w]
    rows = [{"session_id": df_raw["session_id"].iat[i], **windows[i][length]} for i in keep]
    too_quick = int(reached.sum() - reached[keep].sum())
    return pd.DataFrame(rows), reached[keep], length, too_quick


def whole_visits(df_raw, goal_id):
    reached = df_raw["goal_hits"].apply(lambda hits: isinstance(hits, list) and goal_id in hits).to_numpy()
    return df_raw.drop(columns=[c for c in ("windows", "goal_after_ms") if c in df_raw.columns]), reached


def fit(df_raw, goal_id, engineer, features, matrix):
    """engineer and matrix are analyze.py's feature engineering and clustering matrix, so the model sees the same
    measures as the groups."""
    if not goal_id or "goal_hits" not in df_raw.columns:
        return None
    windowed = "windows" in df_raw.columns and df_raw["windows"].apply(lambda w: isinstance(w, dict) and len(w) > 0).any()
    if windowed:
        frame, y, window, too_quick = matched_windows(df_raw, goal_id)
    else:
        (frame, y), window, too_quick = whole_visits(df_raw, goal_id), None, 0
    reached, missed = int(y.sum()), int((~y).sum())
    base = {"reached": reached, "missed": missed, "too_quick": too_quick, "window_s": window}
    if reached < MIN_EACH_SIDE or missed < MIN_EACH_SIDE:
        return {**base, "status": "too_few"}

    engineered = engineer(frame)
    X, used, _ = matrix(engineered, features)
    if X is None:
        return {**base, "status": "no_variation"}
    model = lambda: LogisticRegression(C=0.5, class_weight="balanced", max_iter=2000)
    aucs, signs = [], []
    for train, test in StratifiedKFold(FOLDS, shuffle=True, random_state=RANDOM_SEED).split(X, y):
        m = model().fit(X[train], y[train])
        aucs.append(roc_auc_score(y[test], m.predict_proba(X[test])[:, 1]))
        signs.append(np.sign(m.coef_[0]))
    auc, spread = float(np.mean(aucs)), float(np.std(aucs))
    result = {**base, "auc": round(auc, 4), "auc_spread": round(spread, 4), "features_used": used}
    if auc < MIN_AUC or auc - 2 * spread < 0.55:
        return {**result, "status": "weak"}

    weights = model().fit(X, y).coef_[0]
    steady = np.all(np.array(signs) == np.sign(weights), axis=0)
    drivers = []
    for i in np.argsort(-np.abs(weights)):
        if len(drivers) == MAX_DRIVERS or abs(weights[i]) < MIN_WEIGHT:
            break
        if not steady[i]:
            continue
        values = engineered[used[i]].to_numpy(dtype=float)
        known = ~np.isnan(values)
        split = float(np.median(values[known]))
        above = known & (values > split)
        below = known & (values <= split)
        if above.sum() < 20 or below.sum() < 20:
            continue
        rate_above, rate_below = y[above].mean(), y[below].mean()
        # Overlapping measures can flip a weight's sign, so a measure is only named when the plain rates agree with it.
        if np.sign(rate_above - rate_below) != np.sign(weights[i]) or abs(rate_above - rate_below) < MIN_GAP:
            continue
        drivers.append({
            "feature": used[i], "direction": "higher" if weights[i] > 0 else "lower", "weight": round(float(weights[i]), 3),
            "split": round(split, 4), "rate_above": round(float(y[above].mean()), 4), "rate_below": round(float(y[below].mean()), 4)
        })
    return {**result, "status": "ok" if drivers else "weak", "drivers": drivers}
