import unittest

import numpy as np
import pandas as pd
from sklearn.metrics import adjusted_rand_score

import analyze
import goal_model
import group_shifts


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


    def test_shifts_find_a_group_that_appears_and_stay_quiet_otherwise(self):
        rng = np.random.default_rng(5)
        now = 100 * group_shifts.WEEK_MS
        start = now - rng.integers(0, 12 * group_shifts.WEEK_MS, size=3000)
        values = rng.normal(1, 0.2, size=(3000, 1))
        quiet = rng.integers(0, 2, size=3000)
        steady = group_shifts.shifts(start, quiet, values, ["click_rate"], now)
        self.assertTrue(all(g["event"] is None for g in steady["groups"].values()))
        recent = start > now - 4 * group_shifts.WEEK_MS
        labels = np.where(recent & (rng.random(3000) < 0.3), 2, quiet)
        shifted = group_shifts.shifts(start, labels, values, ["click_rate"], now)
        self.assertEqual(shifted["groups"]["2"]["event"], "appeared")
        self.assertGreater(shifted["groups"]["2"]["since"], now - 5 * group_shifts.WEEK_MS)

    def test_shifts_date_a_step_change_in_a_groups_share(self):
        rng = np.random.default_rng(7)
        now = 100 * group_shifts.WEEK_MS
        start = now - rng.integers(0, 12 * group_shifts.WEEK_MS, size=3000)
        recent = start > now - 3 * group_shifts.WEEK_MS
        labels = (rng.random(3000) < np.where(recent, 0.45, 0.3)).astype(int)
        group = group_shifts.shifts(start, labels, rng.normal(size=(3000, 1)), ["click_rate"], now)["groups"]["1"]
        self.assertEqual(group["event"], "grew")
        self.assertAlmostEqual(group["to"], 0.45, delta=0.05)
        self.assertGreater(group["since"], now - 4 * group_shifts.WEEK_MS)

    def test_map_moves_only_groups_whose_behaviour_really_changed(self):
        rng = np.random.default_rng(8)
        now = 100 * group_shifts.WEEK_MS
        n = 2400
        start = now - rng.integers(0, 12 * group_shifts.WEEK_MS, size=n)
        labels = rng.integers(0, 2, size=n)
        values = rng.normal(1, 0.15, size=(n, 3))
        values[labels == 1] += 1.5
        values[(labels == 1) & (start > now - 4 * group_shifts.WEEK_MS), 0] *= 0.5
        X = (values - values.mean(axis=0)) / values.std(axis=0)
        result = group_shifts.shifts(start, labels, values, ["a", "b", "c"], now, X)
        frames = result["map"]["frames"]
        self.assertEqual(len(frames), len(result["bins"]))
        self.assertTrue(0 < result["map"]["explained"] <= 1)
        self.assertTrue(all(abs(c) <= 1.15 for f in frames for x, y, _ in f["points"] for c in (x, y)))
        self.assertEqual(len({tuple(f["centres"]["0"]) for f in frames}), 1)
        first, last = np.array(frames[0]["centres"]["1"]), np.array(frames[-1]["centres"]["1"])
        self.assertGreater(np.linalg.norm(last - first), 0.1)

    def test_shifts_report_drift_inside_a_group(self):
        rng = np.random.default_rng(6)
        now = 100 * group_shifts.WEEK_MS
        start = now - rng.integers(0, 12 * group_shifts.WEEK_MS, size=2000)
        labels = np.zeros(2000, dtype=int)
        values = rng.normal(2, 0.3, size=(2000, 1))
        values[start > now - 4 * group_shifts.WEEK_MS] *= 0.6
        drift = group_shifts.shifts(start, labels, values, ["dwell_before_click"], now)["groups"]["0"]["drift"]
        self.assertEqual(drift[0]["feature"], "dwell_before_click")
        self.assertLess(drift[0]["change"], -0.3)

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
