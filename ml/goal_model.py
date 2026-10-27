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
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler, FunctionTransformer

RANDOM_SEED = 42
MIN_EACH_SIDE = 40
FOLDS = 5
MIN_AUC = 0.65
MAX_DRIVERS = 3
MIN_WEIGHT = 0.25
MIN_GAP = 0.08
MIN_LATER_EACH_SIDE = 20


class ObservedFeatures(TransformerMixin, BaseEstimator):
    def __init__(self, fill_features=(), unskewed=(), random_state=RANDOM_SEED):
        self.fill_features = fill_features
        self.unskewed = unskewed
        self.random_state = random_state

    def fit(self, X, y=None):
        self.columns_ = list(X.columns)
        self.observed_ = {c: X[c].replace([np.inf, -np.inf], np.nan).dropna().to_numpy(dtype=float)
                          for c in self.columns_ if c in self.fill_features}
        return self

    def transform(self, X):
        rng = np.random.default_rng(self.random_state)
        values = X[self.columns_].replace([np.inf, -np.inf], np.nan).astype(float).copy()
        for column in self.columns_:
            missing = values[column].isna()
            observed = self.observed_.get(column, np.array([]))
            if missing.any():
                values.loc[missing, column] = rng.choice(observed, size=int(missing.sum())) if len(observed) else 0
            values[column] = values[column].clip(lower=0)
            if column not in self.unskewed:
                values[column] = np.log1p(values[column])
        return values.to_numpy()


def clipped(X):
    return np.clip(X, -4, 4)


def model_pipeline(fill_features=(), unskewed=()):
    return Pipeline([
        ("observed", ObservedFeatures(fill_features, unskewed)),
        ("scale", StandardScaler()),
        ("clip", FunctionTransformer(clipped)),
        ("model", LogisticRegression(C=0.5, class_weight="balanced", max_iter=2000))
    ])


def matched_windows(df_raw, goal_id, length=None):
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
    if length is None:
        best = max(balance(s) for s in lengths)
        length = max(s for s in lengths if balance(s) >= best / 2)
    keep = [i for i, w in enumerate(windows) if length in w]
    rows = [{"session_id": df_raw["session_id"].iat[i], **windows[i][length]} for i in keep]
    too_quick = int(reached.sum() - reached[keep].sum())
    return pd.DataFrame(rows), reached[keep], length, too_quick


def whole_visits(df_raw, goal_id):
    reached = df_raw["goal_hits"].apply(lambda hits: isinstance(hits, list) and goal_id in hits).to_numpy()
    return df_raw.drop(columns=[c for c in ("windows", "goal_after_ms") if c in df_raw.columns]), reached


def later_visits(df_raw, goal_id, engineer, features, fill_features, unskewed, windowed):
    if "start_time" not in df_raw.columns:
        return {"status": "missing_time"}
    times = pd.to_numeric(df_raw["start_time"], errors="coerce")
    if times.isna().any() or not np.isfinite(times).all():
        return {"status": "missing_time"}
    order = np.argsort(times.to_numpy(), kind="stable")
    ordered = df_raw.iloc[order]
    boundary = times.iloc[order[int(len(times) * 0.8)]]
    train = ordered[pd.to_numeric(ordered["start_time"]) < boundary]
    test = ordered[pd.to_numeric(ordered["start_time"]) >= boundary]
    if train.empty or test.empty:
        return {"status": "no_time_split"}
    if windowed:
        before, y_train, window, _ = matched_windows(train, goal_id)
        if window is None:
            return {"status": "too_few", "train_visits": 0, "test_visits": 0}
        # The later visits can't choose a window that makes their own outcomes easier to separate.
        after, y_test, _, _ = matched_windows(test, goal_id, window)
    else:
        (before, y_train), (after, y_test), window = whole_visits(train, goal_id), whole_visits(test, goal_id), None
    counts = {"train_visits": len(before), "test_visits": len(after), "train_reached": int(y_train.sum()),
              "test_reached": int(y_test.sum()), "window_s": window, "cutoff_ms": int(boundary),
              "train_from_ms": int(pd.to_numeric(train["start_time"]).min()), "test_to_ms": int(pd.to_numeric(test["start_time"]).max())}
    if min(int(y_train.sum()), int((~y_train).sum())) < MIN_EACH_SIDE or min(int(y_test.sum()), int((~y_test).sum())) < MIN_LATER_EACH_SIDE:
        return {**counts, "status": "too_few"}
    X_train, X_test = engineer(before)[features], engineer(after)[features]
    full = model_pipeline(fill_features, unskewed).fit(X_train, y_train)
    baseline_features = [f for f in ("click_rate", "tap_rate", "scroll_depth_reached") if f in features]
    baseline = model_pipeline(fill_features, unskewed).fit(X_train[baseline_features], y_train)
    full_auc = float(roc_auc_score(y_test, full.predict_proba(X_test)[:, 1]))
    baseline_auc = float(roc_auc_score(y_test, baseline.predict_proba(X_test[baseline_features])[:, 1]))
    return {**counts, "status": "ok", "auc": round(full_auc, 4), "baseline_auc": round(baseline_auc, 4),
            "auc_gain": round(full_auc - baseline_auc, 4), "baseline_features": baseline_features}


def fit(df_raw, goal_id, engineer, features, *, fill_features=(), unskewed=(), excluded=()):
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

    used = [f for f in features if f not in excluded]
    engineered = engineer(frame)
    X = engineered[used]
    aucs, signs = [], []
    for train, test in StratifiedKFold(FOLDS, shuffle=True, random_state=RANDOM_SEED).split(X, y):
        m = model_pipeline(fill_features, unskewed).fit(X.iloc[train], y[train])
        aucs.append(roc_auc_score(y[test], m.predict_proba(X.iloc[test])[:, 1]))
        signs.append(np.sign(m.named_steps["model"].coef_[0]))
    auc, spread = float(np.mean(aucs)), float(np.std(aucs))
    final = model_pipeline(fill_features, unskewed).fit(X, y)
    if not np.any(final.named_steps["scale"].var_ > 1e-18):
        return {**base, "status": "no_variation"}
    temporal = later_visits(df_raw, goal_id, engineer, used, fill_features, unskewed, windowed)
    result = {**base, "auc": round(auc, 4), "auc_spread": round(spread, 4), "features_used": used, "later_visits": temporal}
    if auc < MIN_AUC or auc - 2 * spread < 0.55 or (temporal["status"] == "ok" and temporal["auc"] < MIN_AUC):
        return {**result, "status": "weak"}

    weights = final.named_steps["model"].coef_[0]
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
