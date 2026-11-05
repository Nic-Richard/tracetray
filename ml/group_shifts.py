"""How a page's groups changed over the analysis window, read from the one fit rather than re-clustering per week,
which would make groups "change" whenever k-means landed differently.

Shares use Wilson intervals; share changes a two-proportion test at every split (Bonferroni over splits); drift
Mann-Whitney U; each family is corrected with Benjamini-Hochberg. The map projects the standardized clustering
matrix onto two principal components with one scale for both axes; a group's centre moves only when its drift held.
"""
import math

import numpy as np
from scipy.stats import mannwhitneyu, norm
from sklearn.decomposition import PCA

WEEK_MS = 7 * 24 * 60 * 60 * 1000
MIN_BIN_VISITS = 60
MIN_BINS = 4
FALSE_DISCOVERY = 0.1
# A group "wasn't there" while its share's upper bound stays under this, and "is there" once its share passes the
# second figure.
ABSENT = 0.03
PRESENT = 0.08
MIN_DRIFT = 0.2
MIN_DRIFT_VISITS = 25
MAP_POINTS = 150
# A week's centre for a drifting group needs this many of its visits across the smoothing window.
MIN_CENTRE_VISITS = 15
RANDOM_SEED = 42


def wilson(k, n, z=1.96):
    if n == 0:
        return 0.0, 0.0
    p = k / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return max(0.0, centre - half), min(1.0, centre + half)


def change_point(counts, totals):
    """The split where the share before and after differs most. Returns (p, split bin, share before, share after),
    with p Bonferroni-corrected for the splits tried; each side keeps at least two bins."""
    counts, totals = np.asarray(counts, float), np.asarray(totals, float)
    best = (1.0, None, 0.0, 0.0)
    splits = range(2, len(counts) - 1)
    for split in splits:
        k1, n1, k2, n2 = counts[:split].sum(), totals[:split].sum(), counts[split:].sum(), totals[split:].sum()
        if n1 == 0 or n2 == 0:
            continue
        pooled = (k1 + k2) / (n1 + n2)
        se = math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2)) if 0 < pooled < 1 else 0
        if se == 0:
            continue
        p = min(1.0, float(2 * norm.sf(abs(k2 / n2 - k1 / n1) / se)) * len(splits))
        if p < best[0]:
            best = (p, split, k1 / n1, k2 / n2)
    return best


def bh(pvalues):
    """Indices that pass Benjamini-Hochberg at FALSE_DISCOVERY."""
    order = sorted(range(len(pvalues)), key=lambda i: pvalues[i])
    passed = -1
    for rank, i in enumerate(order, 1):
        if pvalues[i] <= rank / len(pvalues) * FALSE_DISCOVERY:
            passed = rank
    return set(order[:passed]) if passed > 0 else set()


def time_bins(start_ms, now_ms):
    """Weekly bins, or two-week bins when weeks are too thin, oldest first. Returns each visit's bin and the bins."""
    for weeks in (1, 2, 3):
        age = ((now_ms - start_ms) // (weeks * WEEK_MS)).astype(int)
        count = int(age.max()) + 1
        index = count - 1 - age
        sizes = np.bincount(index, minlength=count)
        if count < MIN_BINS:
            return None, None, weeks
        if np.median(sizes) >= MIN_BIN_VISITS or weeks == 3:
            return index, [{"from": int(now_ms - (count - i) * weeks * WEEK_MS), "to": int(now_ms - (count - 1 - i) * weeks * WEEK_MS), "visits": int(sizes[i])} for i in range(count)], weeks
    return None, None, 1


def appeared(lo_hi, shares):
    """Absent in the first two bins, clearly present in the last two."""
    return all(hi < ABSENT for _, hi in lo_hi[:2]) and all(s >= PRESENT for s in shares[-2:])


def drift(values, early, recent, features):
    """Measures of one group that moved between its early and recent visits."""
    rows = []
    for j, feat in enumerate(features):
        a, b = values[early, j], values[recent, j]
        a, b = a[~np.isnan(a)], b[~np.isnan(b)]
        if len(a) < MIN_DRIFT_VISITS or len(b) < MIN_DRIFT_VISITS:
            continue
        before, after = float(np.median(a)), float(np.median(b))
        if before == 0:
            continue
        change = (after - before) / abs(before)
        p = float(mannwhitneyu(a, b, alternative="two-sided").pvalue)
        rows.append({"feature": feat, "before": round(before, 4), "after": round(after, 4), "change": round(change, 3), "p": p})
    return rows


def group_map(X, labels, index, bins, drifting, features):
    """Sampled visits per frame and each group's centre per frame, in [-1, 1] on both axes."""
    pca = PCA(n_components=2, random_state=RANDOM_SEED).fit(X)
    P = pca.transform(X)
    low, high = np.percentile(P, 2, axis=0), np.percentile(P, 98, axis=0)
    half = float(max(high - low)) / 2 or 1.0
    Q = np.clip((P - (low + high) / 2) / half, -1.15, 1.15)
    origin = -(low + high) / 2 / half
    rng = np.random.default_rng(RANDOM_SEED)
    ids = sorted(set(int(l) for l in labels))
    overall = {cid: Q[labels == cid].mean(axis=0) for cid in ids}
    frames = []
    for b in range(bins):
        here = np.flatnonzero(index == b)
        picked = np.sort(rng.choice(here, size=min(len(here), MAP_POINTS), replace=False)) if len(here) else here
        centres = {}
        for cid in ids:
            centre = overall[cid]
            if cid in drifting:
                # Smoothed over the bin and its neighbours.
                near = np.flatnonzero((labels == cid) & (np.abs(index - b) <= 1))
                if len(near) >= MIN_CENTRE_VISITS:
                    centre = Q[near].mean(axis=0)
            centres[str(cid)] = [round(float(centre[0]), 3), round(float(centre[1]), 3)]
        frames.append({"points": [[round(float(Q[i, 0]), 3), round(float(Q[i, 1]), 3), int(labels[i])] for i in picked], "centres": centres})
    # Where most visits fall on each axis, so a view can fill its space without changing the scale between axes.
    extent = [round(float(v), 3) for v in (*np.percentile(Q[:, 0], [2, 98]), *np.percentile(Q[:, 1], [2, 98]))]
    # Loadings as correlations between each standardized measure and each component (components x sqrt(variance)).
    loadings = pca.components_.T * np.sqrt(pca.explained_variance_)
    return {"explained": round(float(pca.explained_variance_ratio_.sum()), 3), "components": [round(float(v), 3) for v in pca.explained_variance_ratio_],
            "loadings": {feat: [round(float(a), 3), round(float(b), 3)] for feat, (a, b) in zip(features, loadings)},
            "origin": [round(float(origin[0]), 3), round(float(origin[1]), 3)], "extent": extent, "frames": frames}


def shifts(start_ms, labels, values, features, now_ms, X=None):
    """None when the window is too short to say anything about change. X, the standardized clustering matrix,
    adds the map for the animated view."""
    start_ms = np.asarray(start_ms, dtype=np.int64)
    index, bins, weeks = time_bins(start_ms, now_ms)
    if index is None:
        return None
    groups, trend_p = {}, []
    ids = sorted(set(int(l) for l in labels))
    for cid in ids:
        counts = [int(((labels == cid) & (index == b)).sum()) for b in range(len(bins))]
        totals = [b["visits"] for b in bins]
        shares = [c / t if t else 0.0 for c, t in zip(counts, totals)]
        lo_hi = [wilson(c, t) for c, t in zip(counts, totals)]
        p, split, before, after = change_point(counts, totals)
        trend_p.append(p)
        groups[cid] = {"shares": [round(s, 4) for s in shares], "low": [round(lo, 4) for lo, _ in lo_hi], "high": [round(hi, 4) for _, hi in lo_hi],
                       "p": p, "split": split, "before": before, "after": after, "lo_hi": lo_hi}
    real = bh(trend_p)
    third = max(1, len(bins) // 3)
    for i, cid in enumerate(ids):
        g = groups[cid]
        shares = g["shares"]
        event = None
        if appeared(g["lo_hi"], shares):
            event = "appeared"
        elif appeared(g["lo_hi"][::-1], shares[::-1]):
            event = "faded"
        elif i in real:
            event = "grew" if g["after"] > g["before"] else "shrank"
        if event in ("appeared", "faded") and i not in real:
            event = None
        g["event"] = event
        if event in ("grew", "shrank"):
            g["from"], g["to"] = round(g["before"], 4), round(g["after"], 4)
            g["since"] = bins[g["split"]]["from"]
        else:
            g["from"] = round(float(np.mean(shares[:third])), 4)
            g["to"] = round(float(np.mean(shares[-third:])), 4)
        for key in ("split", "before", "after"):
            del g[key]
        if event == "appeared":
            g["since"] = bins[next(b for b, s in enumerate(shares) if s >= PRESENT)]["from"]
        if event == "faded":
            last = max(b for b, s in enumerate(shares) if s >= PRESENT)
            g["since"] = bins[min(last + 1, len(bins) - 1)]["from"]
        del g["lo_hi"]

    early_cut = index < len(bins) // 2
    recent_cut = index >= len(bins) - third
    drift_rows = []
    for cid in ids:
        mine = labels == cid
        for row in drift(values, mine & early_cut, mine & recent_cut, features):
            drift_rows.append((cid, row))
    passed = bh([row["p"] for _, row in drift_rows]) if drift_rows else set()
    for cid in ids:
        groups[cid]["drift"] = []
    for i, (cid, row) in enumerate(drift_rows):
        if i in passed and abs(row["change"]) >= MIN_DRIFT:
            groups[cid]["drift"].append({k: v for k, v in row.items() if k != "p"})
    for cid in ids:
        groups[cid]["drift"] = sorted(groups[cid]["drift"], key=lambda r: -abs(r["change"]))[:2]
        groups[cid]["p"] = round(groups[cid]["p"], 6)
    out = {"bin_weeks": weeks, "bins": bins, "groups": {str(cid): g for cid, g in groups.items()}}
    if X is not None and X.shape[1] >= 2:
        out["map"] = group_map(X, labels, index, len(bins), {cid for cid in ids if groups[cid]["drift"]}, features)
    return out
