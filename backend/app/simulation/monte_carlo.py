"""Monte Carlo match simulator.

Simulates >= 100,000 virtual matches per fixture with numpy vectorisation:
- goals: correlated Poisson draws (shared "game state" factor reproduces the
  empirical over-dispersion of real football scores);
- corners: normal model driven by expected tempo and team corner rates;
- cards: normal model driven by referee profile and derby/cards multipliers;
- scorers: per-player anytime-scorer probabilities allocated from team
  expected goals and player xG shares.
"""
from __future__ import annotations

import numpy as np

from ..config import get_settings
from ..schemas import PlayerReport, RefereeProfile, SimulationSummary


def simulate_match(
    lam_h: float,
    lam_a: float,
    *,
    corners_mu: float = 9.8,
    cards_mu: float = 4.2,
    cards_multiplier: float = 1.0,
    corners_multiplier: float = 1.0,
    referee: RefereeProfile | None = None,
    home_scorers: list[PlayerReport] | None = None,
    away_scorers: list[PlayerReport] | None = None,
    n: int | None = None,
    seed: int | None = None,
) -> SimulationSummary:
    settings = get_settings()
    n = n or settings.n_simulations
    rng = np.random.default_rng(seed if seed is not None else settings.random_seed)

    # shared game-state factor -> positive correlation between the two scores
    state = rng.gamma(shape=8.0, scale=1 / 8.0, size=n)
    gh = rng.poisson(np.clip(lam_h * state, 0.02, None))
    ga = rng.poisson(np.clip(lam_a * state, 0.02, None))
    total = gh + ga

    # primo tempo: ~44% dei gol arrivano nella prima frazione
    gh1 = rng.binomial(gh, 0.44)
    ga1 = rng.binomial(ga, 0.44)
    total_1h = gh1 + ga1

    p_home = float(np.mean(gh > ga))
    p_draw = float(np.mean(gh == ga))
    p_away = float(np.mean(gh < ga))

    over_under = {
        str(line): round(float(np.mean(total > line)), 4)
        for line in (0.5, 1.5, 2.5, 3.5, 4.5, 5.5)
    }
    btts = float(np.mean((gh > 0) & (ga > 0)))

    # exact scores (top 10)
    capped_h = np.minimum(gh, 5)
    capped_a = np.minimum(ga, 5)
    codes = capped_h * 6 + capped_a
    counts = np.bincount(codes, minlength=36) / n
    order = np.argsort(counts)[::-1][:10]
    exact = {f"{c // 6}-{c % 6}": round(float(counts[c]), 4) for c in order if counts[c] > 0}

    # corners
    cor_mu = corners_mu * corners_multiplier * (0.85 + 0.15 * (lam_h + lam_a) / 2.7)
    corners = np.maximum(0, rng.normal(cor_mu, 3.0, n))
    # cards
    ref_mult = 1.0
    if referee is not None:
        ref_mult = referee.avg_yellow_cards / 4.1
    card_mu = cards_mu * cards_multiplier * ref_mult
    cards = np.maximum(0, rng.normal(card_mu, 1.9, n))

    handicap = {}
    for hc in (-2.5, -1.5, -0.5, 0.5, 1.5, 2.5):
        handicap[f"HOME{hc:+g}"] = round(float(np.mean(gh + hc > ga)), 4)
        handicap[f"AWAY{hc:+g}"] = round(float(np.mean(ga + hc > gh)), 4)

    team_totals = {
        "home_over_0.5": round(float(np.mean(gh > 0.5)), 4),
        "home_over_1.5": round(float(np.mean(gh > 1.5)), 4),
        "home_over_2.5": round(float(np.mean(gh > 2.5)), 4),
        "away_over_0.5": round(float(np.mean(ga > 0.5)), 4),
        "away_over_1.5": round(float(np.mean(ga > 1.5)), 4),
        "away_over_2.5": round(float(np.mean(ga > 2.5)), 4),
    }

    corners_over = {
        str(line): round(float(np.mean(corners > line)), 4)
        for line in (7.5, 8.5, 9.5, 10.5, 11.5)
    }
    cards_over = {
        str(line): round(float(np.mean(cards > line)), 4)
        for line in (2.5, 3.5, 4.5, 5.5)
    }
    first_half_over = {
        "0.5": round(float(np.mean(total_1h > 0.5)), 4),
        "1.5": round(float(np.mean(total_1h > 1.5)), 4),
    }
    goals_odd = round(float(np.mean(total % 2 == 1)), 4)
    multigol = {
        f"{lo}-{hi}": round(float(np.mean((total >= lo) & (total <= hi))), 4)
        for lo, hi in ((1, 2), (1, 3), (2, 3), (2, 4), (3, 5))
    }
    home_win = gh > ga
    away_win = ga > gh
    combos = {
        "HOME&O1.5": round(float(np.mean(home_win & (total > 1.5))), 4),
        "HOME&O2.5": round(float(np.mean(home_win & (total > 2.5))), 4),
        "HOME&U3.5": round(float(np.mean(home_win & (total < 3.5))), 4),
        "AWAY&O1.5": round(float(np.mean(away_win & (total > 1.5))), 4),
        "AWAY&O2.5": round(float(np.mean(away_win & (total > 2.5))), 4),
        "AWAY&U3.5": round(float(np.mean(away_win & (total < 3.5))), 4),
        "DRAW&U2.5": round(float(np.mean((gh == ga) & (total < 2.5))), 4),
    }

    # anytime scorer probabilities from player xG shares
    top_scorers: dict[str, float] = {}
    for players, lam, side in ((home_scorers or [], lam_h, "H"), (away_scorers or [], lam_a, "A")):
        attackers = [p for p in players if p.xg > 0.5][:4]
        total_xg = sum(p.xg for p in attackers) or 1.0
        for p in attackers:
            share = p.xg / total_xg * 0.82  # rest goes to squad depth / own goals
            p_any = 1.0 - np.exp(-lam * share)
            top_scorers[f"{p.name} ({side})"] = round(float(p_any), 4)

    return SimulationSummary(
        n_simulations=n,
        lambda_home=round(lam_h, 3),
        lambda_away=round(lam_a, 3),
        p_home=round(p_home, 4),
        p_draw=round(p_draw, 4),
        p_away=round(p_away, 4),
        over_under=over_under,
        btts=round(btts, 4),
        exact_scores=exact,
        corners_avg=round(float(np.mean(corners)), 2),
        corners_over_9_5=round(float(np.mean(corners > 9.5)), 4),
        cards_avg=round(float(np.mean(cards)), 2),
        cards_over_4_5=round(float(np.mean(cards > 4.5)), 4),
        handicap=handicap,
        team_totals=team_totals,
        top_scorers=dict(sorted(top_scorers.items(), key=lambda kv: kv[1], reverse=True)[:8]),
        corners_over=corners_over,
        cards_over=cards_over,
        first_half_over=first_half_over,
        goals_odd=goals_odd,
        multigol=multigol,
        combos=combos,
        clean_sheet_home=round(float(np.mean(ga == 0)), 4),
        clean_sheet_away=round(float(np.mean(gh == 0)), 4),
        win_to_nil_home=round(float(np.mean(home_win & (ga == 0))), 4),
        win_to_nil_away=round(float(np.mean(away_win & (gh == 0))), 4),
    )
