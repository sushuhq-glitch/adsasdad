"""Closed-form probability helpers built on a bivariate Poisson-style model.

These are used both to price the synthetic bookmaker odds in the demo
provider and as one of the analytical models in the ensemble (the Monte
Carlo engine provides the empirical counterpart).
"""
from __future__ import annotations

import math
from functools import lru_cache

MAX_GOALS = 10


@lru_cache(maxsize=4096)
def poisson_pmf_vector(lam: float, max_goals: int = MAX_GOALS) -> tuple[float, ...]:
    lam = max(lam, 1e-6)
    out = []
    for k in range(max_goals + 1):
        out.append(math.exp(-lam) * lam**k / math.factorial(k))
    # dump the tail mass on the last bucket so the vector sums to 1
    out[-1] += max(0.0, 1.0 - sum(out))
    return tuple(out)


def score_matrix(lambda_home: float, lambda_away: float, rho: float = -0.08) -> list[list[float]]:
    """Score probability matrix with a Dixon-Coles low-score correction.

    ``rho`` slightly re-weights 0-0/1-0/0-1/1-1 which independent Poissons
    are known to misprice.
    """
    ph = poisson_pmf_vector(round(lambda_home, 4))
    pa = poisson_pmf_vector(round(lambda_away, 4))
    m = [[ph[i] * pa[j] for j in range(MAX_GOALS + 1)] for i in range(MAX_GOALS + 1)]

    def tau(i: int, j: int) -> float:
        if i == 0 and j == 0:
            return 1 - lambda_home * lambda_away * rho
        if i == 0 and j == 1:
            return 1 + lambda_home * rho
        if i == 1 and j == 0:
            return 1 + lambda_away * rho
        if i == 1 and j == 1:
            return 1 - rho
        return 1.0

    for i in (0, 1):
        for j in (0, 1):
            m[i][j] *= max(tau(i, j), 0.0)

    total = sum(sum(row) for row in m)
    return [[v / total for v in row] for row in m]


def outcome_probs(m: list[list[float]]) -> tuple[float, float, float]:
    p_home = sum(m[i][j] for i in range(len(m)) for j in range(len(m)) if i > j)
    p_draw = sum(m[i][i] for i in range(len(m)))
    p_away = 1.0 - p_home - p_draw
    return p_home, p_draw, max(p_away, 0.0)


def over_prob(m: list[list[float]], line: float) -> float:
    return sum(
        m[i][j] for i in range(len(m)) for j in range(len(m)) if i + j > line
    )


def btts_prob(m: list[list[float]]) -> float:
    return sum(m[i][j] for i in range(1, len(m)) for j in range(1, len(m)))


def team_over_prob(m: list[list[float]], line: float, home: bool) -> float:
    if home:
        return sum(m[i][j] for i in range(len(m)) for j in range(len(m)) if i > line)
    return sum(m[i][j] for i in range(len(m)) for j in range(len(m)) if j > line)


def handicap_cover_prob(m: list[list[float]], handicap: float, home: bool) -> float:
    """Probability that (team goals + handicap) beats the opponent (half lines only)."""
    p = 0.0
    for i in range(len(m)):
        for j in range(len(m)):
            margin = (i - j) if home else (j - i)
            if margin + handicap > 0:
                p += m[i][j]
    return p


def draw_no_bet_prob(m: list[list[float]], home: bool) -> float:
    p_home, p_draw, p_away = outcome_probs(m)
    win = p_home if home else p_away
    denom = 1.0 - p_draw
    return win / denom if denom > 1e-9 else 0.0


def goals_odd_prob(m: list[list[float]]) -> float:
    return sum(
        m[i][j] for i in range(len(m)) for j in range(len(m)) if (i + j) % 2 == 1
    )


def multigol_prob(m: list[list[float]], lo: int, hi: int) -> float:
    """Probabilità che il totale gol sia compreso tra lo e hi inclusi."""
    return sum(
        m[i][j] for i in range(len(m)) for j in range(len(m)) if lo <= i + j <= hi
    )


def combo_prob(m: list[list[float]], side: str, line: float, over: bool) -> float:
    """Esito finale combinato con Over/Under (es. 1 & Over 1.5)."""
    p = 0.0
    for i in range(len(m)):
        for j in range(len(m)):
            if side == "HOME" and not i > j:
                continue
            if side == "AWAY" and not j > i:
                continue
            if side == "DRAW" and i != j:
                continue
            total = i + j
            if (over and total > line) or (not over and total < line):
                p += m[i][j]
    return p


def clean_sheet_prob(m: list[list[float]], home: bool) -> float:
    if home:
        return sum(m[i][0] for i in range(len(m)))
    return sum(m[0][j] for j in range(len(m)))


def win_to_nil_prob(m: list[list[float]], home: bool) -> float:
    if home:
        return sum(m[i][0] for i in range(1, len(m)))
    return sum(m[0][j] for j in range(1, len(m)))


def first_half_over_prob(lambda_home: float, lambda_away: float, line: float,
                         share: float = 0.44) -> float:
    """Over nel primo tempo: quota tipica del 44% dei gol nella prima frazione."""
    m1 = score_matrix(lambda_home * share, lambda_away * share, rho=-0.05)
    return over_prob(m1, line)


def exact_score_probs(m: list[list[float]], top: int = 8) -> dict[str, float]:
    flat = [
        (f"{i}-{j}", m[i][j]) for i in range(min(6, len(m))) for j in range(min(6, len(m)))
    ]
    flat.sort(key=lambda t: t[1], reverse=True)
    return dict(flat[:top])
