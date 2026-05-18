"""Metrics utilities for LOCO-Agent."""

from __future__ import annotations


def jains_fairness(values: list[float]) -> float:
    """Jain's fairness index. Returns 1.0 when all values are equal.

    Filters out zero/negative values before computing.
    Returns 1.0 if no positive values remain.
    """
    positive = [v for v in values if v > 0]
    if not positive:
        return 1.0
    n = len(positive)
    total = sum(positive)
    sum_sq = sum(v * v for v in positive)
    return (total * total) / (n * sum_sq)
