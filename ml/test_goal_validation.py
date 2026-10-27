import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd
from sklearn.pipeline import Pipeline

import analyze
import goal_model
from test_analyze import windowed_visits


class GoalValidationTest(unittest.TestCase):
    def fit(self, rows):
        return goal_model.fit(rows, "g", analyze.engineer_desktop_features, analyze.DESKTOP_ENGINEERED_FEATURES,
                              fill_features=analyze.FILL_TYPICAL, unskewed=analyze.UNSKEWED, excluded=analyze.CLUSTER_EXCLUDED)

    def test_unseen_values_cannot_change_filling_or_scaling(self):
        train = pd.DataFrame({"cursor": [1.0, 3.0, np.nan, 1.0], "depth": [0.2, 0.4, 0.6, 0.8]})
        model = goal_model.model_pipeline(fill_features={"cursor"}, unskewed={"cursor", "depth"}).fit(train, [0, 1, 0, 1])
        self.assertIsInstance(model, Pipeline)
        mean = model.named_steps["scale"].mean_.copy()
        unseen = pd.DataFrame({"cursor": [np.nan, 1000000.0], "depth": [0.5, 0.5]})
        filled = model.named_steps["observed"].transform(unseen)
        self.assertIn(filled[0, 0], (1.0, 3.0))
        model.predict_proba(unseen)
        np.testing.assert_array_equal(model.named_steps["scale"].mean_, mean)
        empty = goal_model.ObservedFeatures(fill_features={"cursor"}, unskewed={"cursor", "depth"}).fit(train.assign(cursor=np.nan))
        self.assertEqual(empty.transform(unseen)[0, 0], 0)

    def test_later_visits_use_earlier_preprocessing_and_a_simple_baseline(self):
        rows = windowed_visits(np.random.default_rng(21), 1600, depth_effect=2.0)
        rows["start_time"] = np.arange(len(rows)) * 1000
        result = self.fit(rows)
        later = result["later_visits"]
        self.assertEqual(later["status"], "ok")
        self.assertEqual(later["train_visits"], 1280)
        self.assertEqual(later["test_visits"], 320)
        self.assertGreater(later["auc"], 0.7)
        self.assertEqual(later["baseline_features"], ["click_rate", "scroll_depth_reached"])
        self.assertAlmostEqual(later["auc_gain"], later["auc"] - later["baseline_auc"], places=3)
        reversed_result = self.fit(rows.iloc[::-1].reset_index(drop=True))
        self.assertEqual(later, reversed_result["later_visits"])

    def test_missing_timestamps_and_tied_times_do_not_fake_a_later_test(self):
        rows = windowed_visits(np.random.default_rng(22), 800, depth_effect=2.0)
        self.assertEqual(self.fit(rows)["later_visits"]["status"], "missing_time")
        rows["start_time"] = 1000
        self.assertEqual(self.fit(rows)["later_visits"]["status"], "no_time_split")

    def test_later_outcomes_cannot_choose_the_window(self):
        rows = windowed_visits(np.random.default_rng(23), 1600, depth_effect=2.0)
        rows["start_time"] = np.arange(len(rows)) * 1000
        for i in range(1280, len(rows)):
            rows.at[i, "windows"] = {"5": rows.at[i, "windows"]["10"], "10": rows.at[i, "windows"]["10"]}
        calls = []
        original = goal_model.matched_windows

        def record(frame, goal, length=None):
            calls.append((len(frame), length))
            return original(frame, goal, length)

        with patch.object(goal_model, "matched_windows", side_effect=record):
            result = self.fit(rows)
        self.assertIn((1280, None), calls)
        self.assertIn((320, 10), calls)
        self.assertEqual(result["later_visits"]["window_s"], 10)

    def test_a_failed_later_check_holds_back_findings(self):
        rows = windowed_visits(np.random.default_rng(24), 1600, depth_effect=3.0)
        rows["start_time"] = np.arange(len(rows)) * 1000
        for i in range(1280, len(rows)):
            rows.at[i, "goal_hits"] = [] if rows.at[i, "goal_hits"] else ["g"]
        result = self.fit(rows)
        self.assertGreater(result["auc"], goal_model.MIN_AUC)
        self.assertLess(result["later_visits"]["auc"], 0.5)
        self.assertEqual(result["status"], "weak")


if __name__ == "__main__":
    unittest.main()
