import numpy as np
import pandas as pd


TYPES = [(0.4, 0.16, 25, 0.3, 1.2), (0.35, 0.015, 160, 0.9, 0.18), (0.25, 0.045, 65, 0.6, 0.55)]


def desktop_visits(rng, n, types=TYPES, scroll_only=0.0):
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


def goal_visits(seed, n=800, signal=0.0, after_goal=False, device="desktop"):
    rng = np.random.default_rng(seed)
    frame, _ = desktop_visits(rng, n, [(1, 0.03, 10, 0.5, 0.5)], scroll_only=0.15)
    rows = frame.to_dict("records")
    for i, row in enumerate(rows):
        row["duration_ms"] = row["active_ms"] = 10000
        chance = 1 / (1 + np.exp(-signal * (row["scroll_depth_reached"] - 0.5) * 10))
        reached = rng.random() < chance
        row["goal_hits"] = ["g"] if reached else []
        row["start_time"] = 1780000000000 + i * 100000
        row["windows"] = {"10": {k: v for k, v in row.items() if k not in ("session_id", "goal_hits", "start_time")}}
        if after_goal:
            row["clicks"] = row["clicks"] + int(reached) * 15
            row["scroll_depth_reached"] = 0.95 if reached else row["scroll_depth_reached"]
    if device == "mobile":
        def phone(row):
            return {**row, "taps": row["clicks"], "attention_pauses": row["cursor_pauses"],
                "avg_attention_pause_ms": 1500 if row["cursor_pauses"] else 0,
                "dwell_before_tap": row["dwell_before_click"], "scroll_velocity": row["avg_cursor_velocity"]}
        rows = [{**phone(row), "windows": {key: phone(window) for key, window in row["windows"].items()}} for row in rows]
    return pd.DataFrame(rows)


def continuous_measures(seed, n):
    rng = np.random.default_rng(seed)
    level = rng.uniform(0.05, 0.95, n)
    return pd.DataFrame({
        "scroll_depth_reached": level,
        "avg_cursor_velocity": np.expm1(level + rng.normal(0, 0.025, n)),
        "click_rate": np.expm1(level + rng.normal(0, 0.025, n))
    })


def planted_visits(seed, n, scroll_only=0.0):
    rng = np.random.default_rng(seed)
    truth = rng.integers(0, 3, n)
    rows = []
    for i, group in enumerate(truth):
        moves = 0 if rng.random() < scroll_only else 200
        clicks = max(1, int(rng.poisson([3, 15, 15][group])))
        rows.append({
            "session_id": f"p{i}", "duration_ms": 100000, "active_ms": 100000, "mouse_moves": moves,
            "cursor_pauses": 10 if moves else 0, "clicks": clicks, "total_cursor_distance": moves * 60.0,
            "avg_cursor_velocity": float(rng.normal([0.2, 1.2, 1.2][group], 0.03)) if moves else 0,
            "dwell_before_click": 900 if moves else 0, "scroll_depth_reached": float(rng.normal([0.2, 0.8, 0.2][group], 0.03)),
            "scroll_direction_changes": 2, "scroll_bursts": 1,
            **{f"grid_{r}_{c}": moves / 9 for r in range(3) for c in range(3)}
        })
    return pd.DataFrame(rows), truth
