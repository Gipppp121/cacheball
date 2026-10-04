"""cost.py: price agent turns, not tokens.

Reads one JSON line per API call and prints, per model:
tasks, passed, avg turns, $/turn and $/pass.

usage:  python cost.py usage.jsonl
"""
import json
import sys
from collections import defaultdict

PRICE = {  # $ per 1M tokens, Oct 2026 list prices, 5-minute cache writes
    "claude-sonnet-5-5": {"in": 2.0, "out": 10.0, "read": 0.20, "write": 2.50},
    "claude-opus-5-5":   {"in": 4.0, "out": 20.0, "read": 0.20, "write": 5.00},
}


def call_cost(model, u):
    p = PRICE[model]
    return (u["input_tokens"] * p["in"]
            + u["output_tokens"] * p["out"]
            + u.get("cache_read_input_tokens", 0) * p["read"]
            + u.get("cache_creation_input_tokens", 0) * p["write"]) / 1e6


def main(path):
    tasks = defaultdict(lambda: {"turns": 0, "cost": 0.0, "passed": False, "model": ""})
    with open(path) as f:
        for line in f:
            if not line.strip():
                continue
            r = json.loads(line)
            t = tasks[(r["model"], r["task"])]
            t["turns"] += 1
            t["cost"] += call_cost(r["model"], r["usage"])
            t["passed"] = t["passed"] or r.get("passed", False)
            t["model"] = r["model"]

    for model in PRICE:
        rows = [t for t in tasks.values() if t["model"] == model]
        if not rows:
            continue
        done = [t for t in rows if t["passed"]]
        turns = sum(t["turns"] for t in rows) / len(rows)
        per_turn = sum(t["cost"] for t in rows) / sum(t["turns"] for t in rows)
        per_pass = sum(t["cost"] for t in rows) / max(len(done), 1)
        print(f"{model:20} tasks {len(rows):3}  passed {len(done):3}  "
              f"avg turns {turns:5.1f}  $/turn {per_turn:.4f}  $/pass {per_pass:.3f}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "usage.example.jsonl")
