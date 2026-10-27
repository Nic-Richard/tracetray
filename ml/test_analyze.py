import unittest

import numpy as np
import pandas as pd
from sklearn.metrics import adjusted_rand_score

import analyze
import goal_model


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


    def test_snapshot_uses_fixed_axes_and_a_bounded_sample(self):
        df, _ = desktop_visits(np.random.default_rng(4), 600, [(1, 0.03, 40, 0.5, 0.5)])
        features = analyze.engineer_desktop_features(df)
        labels = np.arange(len(df)) % 2
        shot = analyze.snapshot(features, labels)
        self.assertEqual(len(shot["points"]), analyze.SNAPSHOT_POINTS)
        self.assertTrue(all(0 <= x <= 1 and 0 <= y <= np.log10(3600) for x, y, _ in shot["points"]))
        self.assertEqual(set(shot["centres"]), {0, 1})


def windowed_visits(rng, n, depth_effect):
    """Visits measured over a 10 s window; reaching the goal depends on scroll depth by depth_effect."""
    df, _ = desktop_visits(rng, n, [(1, 0.03, 60, 0.5, 0.5)])
    rows = df.to_dict("records")
    for row in rows:
        chance = 1 / (1 + np.exp(-depth_effect * (row["scroll_depth_reached"] - 0.5) * 10))
        row["goal_hits"] = ["g"] if rng.random() < chance else []
        row["windows"] = {"10": {k: v for k, v in row.items() if k not in ("session_id", "goal_hits")}}
    return pd.DataFrame(rows)


class GoalModelTest(unittest.TestCase):
    def fit(self, df):
        return goal_model.fit(df, "g", analyze.engineer_desktop_features, analyze.DESKTOP_ENGINEERED_FEATURES,
                              fill_features=analyze.FILL_TYPICAL, unskewed=analyze.UNSKEWED, excluded=analyze.CLUSTER_EXCLUDED)

    def test_a_real_link_is_found_with_its_direction(self):
        result = self.fit(windowed_visits(np.random.default_rng(5), 800, depth_effect=1.0))
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["drivers"][0]["feature"], "scroll_depth_reached")
        self.assertEqual(result["drivers"][0]["direction"], "higher")
        self.assertGreater(result["drivers"][0]["rate_above"], result["drivers"][0]["rate_below"])

    def test_noise_names_nothing(self):
        result = self.fit(windowed_visits(np.random.default_rng(6), 800, depth_effect=0.0))
        self.assertNotEqual(result["status"], "ok")

    def test_too_few_visits_on_one_side_are_reported(self):
        df = windowed_visits(np.random.default_rng(7), 800, depth_effect=1.0)
        df["goal_hits"] = [["g"] if i < 10 else [] for i in range(len(df))]
        self.assertEqual(self.fit(df)["status"], "too_few")


if __name__ == "__main__":
    unittest.main()
