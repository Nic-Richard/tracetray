import unittest

import numpy as np
import pandas as pd
from sklearn.metrics import adjusted_rand_score

import analyze


def desktop_visits(rng, n, types, scroll_only=0.0):
    """types: list of (share, clicks a second, seconds on page, page depth, cursor speed)."""
    shares = np.array([t[0] for t in types])
    truth = rng.choice(len(types), size=n, p=shares / shares.sum())
    rows = []
    for i, t in enumerate(truth):
        _, click_rate, seconds, depth, speed = types[t]
        secs = float(np.exp(rng.normal(np.log(seconds), 0.5)))
        moves = 0 if rng.random() < scroll_only else int(rng.poisson(secs * 2) + 1)
        clicks = int(rng.poisson(secs * click_rate))
        grid = {f"grid_{r}_{c}": float(rng.random() * moves) for r in range(3) for c in range(3)} if moves else {}
        rows.append({
            "session_id": f"s{i}", "duration_ms": secs * 1000, "active_ms": secs * 1000, "mouse_moves": moves,
            "cursor_pauses": int(rng.poisson(secs * 0.1)) if moves else 0, "clicks": clicks,
            "total_cursor_distance": moves * 60.0, "avg_cursor_velocity": float(rng.normal(speed, speed / 5)) if moves else 0.0,
            "dwell_before_click": float(rng.normal(900, 200)) if clicks and moves else 0.0,
            "scroll_depth_reached": float(np.clip(rng.normal(depth, 0.1), 0.05, 1)),
            "scroll_direction_changes": int(rng.poisson(secs * 0.02)), "scroll_bursts": 1, **grid,
        })
    return pd.DataFrame(rows), truth


def groups(df):
    features = analyze.engineer_desktop_features(df)
    X, _, _ = analyze.clustering_matrix(features, analyze.DESKTOP_ENGINEERED_FEATURES)
    min_size = analyze.min_group_size(len(df))
    _, k, labels, _, _, _, verdict = analyze.cluster(X, analyze.compute_k_range(len(df), min_size), min_size)
    return k, labels, verdict


class ClusteringTest(unittest.TestCase):
    def test_visits_without_cursor_movement_are_not_a_group_of_their_own(self):
        rng = np.random.default_rng(1)
        df, _ = desktop_visits(rng, 600, [(1, 0.03, 40, 0.5, 0.5)], scroll_only=0.2)
        features = analyze.engineer_desktop_features(df)
        self.assertTrue(features.loc[df["mouse_moves"] == 0, "top_zone_ratio"].isna().all(), "unknown, not zero")
        _, labels, verdict = groups(df)
        self.assertEqual(verdict, "none")
        for group in set(labels):
            share = (df["mouse_moves"][labels == group] == 0).mean()
            self.assertLess(share, 0.6, "a group made of scroll-only visits")

    def test_real_groups_are_found(self):
        rng = np.random.default_rng(2)
        df, truth = desktop_visits(rng, 600, [(0.6, 0.1, 30, 0.5, 0.9), (0.4, 0.01, 150, 0.9, 0.2)], scroll_only=0.15)
        k, labels, verdict = groups(df)
        self.assertEqual(k, 2)
        self.assertIn(verdict, ("clear", "some"))
        self.assertGreater(adjusted_rand_score(truth, labels), 0.8)

    def test_same_visits_give_the_same_groups(self):
        df, _ = desktop_visits(np.random.default_rng(3), 300, [(1, 0.03, 40, 0.5, 0.5)], scroll_only=0.3)
        self.assertEqual(groups(df)[1].tolist(), groups(df.copy())[1].tolist())


if __name__ == "__main__":
    unittest.main()
