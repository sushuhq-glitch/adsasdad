"""Motore di analisi partita.

Orchestrazione completa: raccolta dati -> correzioni contestuali ->
ensemble di modelli -> simulazione Monte Carlo -> valutazione di ogni
mercato disponibile (probabilità stimata, quota equa, value, confidenza).
"""
from __future__ import annotations

import threading
from datetime import datetime, timezone

from ..analysis.adjustments import AdjustmentResult, apply_adjustments
from ..data.aggregator import get_aggregator
from ..ml.ensemble import ModelEnsemble
from ..schemas import (
    Fixture,
    MarketEvaluation,
    MatchAnalysis,
    ModelProbability,
    OddsBoard,
    SimulationSummary,
)
from ..simulation.monte_carlo import simulate_match

_cache: dict[str, MatchAnalysis] = {}
_cache_lock = threading.Lock()


def _market_probability(market_id: str, sim: SimulationSummary,
                        p_home: float, p_draw: float, p_away: float) -> float | None:
    """Probabilità stimata dal sistema per un mercato del board."""
    parts = market_id.split(":")
    kind = parts[0]
    if kind == "1X2":
        return {"HOME": p_home, "DRAW": p_draw, "AWAY": p_away}[parts[1]]
    if kind == "DC":
        return {"1X": p_home + p_draw, "X2": p_draw + p_away, "12": p_home + p_away}[parts[1]]
    if kind == "DNB":
        denom = 1.0 - p_draw
        if denom <= 1e-9:
            return None
        return (p_home if parts[1] == "HOME" else p_away) / denom
    if kind == "BTTS":
        return sim.btts if parts[1] == "YES" else 1.0 - sim.btts
    if kind == "OU":
        over = sim.over_under.get(parts[1])
        if over is None:
            return None
        return over if parts[2] == "OVER" else 1.0 - over
    if kind == "AH":
        side, hc = parts[1], float(parts[2])
        return sim.handicap.get(f"{side}{hc:+g}")
    if kind == "TT":
        side, line = parts[1].lower(), parts[2]
        return sim.team_totals.get(f"{side}_over_{line}")
    if kind == "CORN":
        return sim.corners_over_9_5 if parts[2] == "OVER" else 1.0 - sim.corners_over_9_5
    if kind == "CARD":
        return sim.cards_over_4_5 if parts[2] == "OVER" else 1.0 - sim.cards_over_4_5
    return None


def _devig_book(market_id: str) -> tuple[str, float] | None:
    """Chiave del "libro" di selezioni complementari (somma equa = fair_total)
    su cui normalizzare il margine del bookmaker. None = de-vig non applicabile."""
    parts = market_id.split(":")
    kind = parts[0]
    if kind == "1X2":
        return ("1X2", 1.0)
    if kind == "DC":
        return ("DC", 2.0)  # le tre doppie chance sommano a 2 in termini equi
    if kind == "DNB":
        return ("DNB", 1.0)
    if kind == "BTTS":
        return ("BTTS", 1.0)
    if kind == "OU":
        return (f"OU:{parts[1]}", 1.0)
    if kind == "AH":
        # HOME:-1.5 complementa AWAY:+1.5 -> chiave normalizzata sull'handicap casa
        hc = float(parts[2])
        home_hc = hc if parts[1] == "HOME" else -hc
        return (f"AH:{home_hc:+g}", 1.0)
    if kind in {"CORN", "CARD"}:
        return (f"{kind}:{parts[1]}", 1.0)
    return None  # es. Team Totals: quotato solo l'Over, nessun libro completo


def _evaluate_markets(
    board: OddsBoard,
    sim: SimulationSummary,
    p_home: float,
    p_draw: float,
    p_away: float,
    agreement: float,
    data_quality: float,
) -> list[MarketEvaluation]:
    evals: list[MarketEvaluation] = []

    # somma delle probabilità implicite per libro complementare
    sums: dict[str, float] = {}
    counts: dict[str, int] = {}
    for mk in board.markets:
        book = _devig_book(mk.market_id)
        if book:
            sums[book[0]] = sums.get(book[0], 0.0) + 1.0 / mk.avg_odds
            counts[book[0]] = counts.get(book[0], 0) + 1

    for mk in board.markets:
        p = _market_probability(mk.market_id, sim, p_home, p_draw, p_away)
        if p is None or not (0.005 < p < 0.999):
            continue
        implied = 1.0 / mk.avg_odds
        # de-vig proporzionale sul libro di selezioni complementari
        book = _devig_book(mk.market_id)
        devig = implied
        if book and counts.get(book[0], 0) >= 2:
            overround = sums[book[0]] / book[1]
            if overround > 0:
                devig = implied / overround
        value = p * mk.best_odds - 1.0
        # confidenza: accordo tra modelli * qualità dati * distanza dagli estremi
        extremity = 1.0 - abs(p - 0.5) * 0.35
        confidence = max(0.0, min(1.0, agreement * data_quality * extremity))
        b = mk.best_odds - 1.0
        kelly = max(0.0, (p * b - (1 - p)) / b) if b > 0 else 0.0
        evals.append(
            MarketEvaluation(
                market_id=mk.market_id,
                market_group=mk.market_group,
                selection=mk.selection,
                probability=round(p, 4),
                fair_odds=round(1.0 / p, 2),
                best_odds=mk.best_odds,
                best_bookmaker=mk.best_bookmaker,
                value_pct=round(value * 100, 2),
                edge_over_market=round((p - devig) * 100, 2),
                confidence=round(confidence, 3),
                kelly_fraction=round(min(kelly, 0.25), 4),
            )
        )
    evals.sort(key=lambda e: e.probability, reverse=True)
    return evals


def analyze_fixture(fixture_id: str, use_cache: bool = True) -> MatchAnalysis:
    with _cache_lock:
        if use_cache and fixture_id in _cache:
            return _cache[fixture_id]

    agg = get_aggregator()
    fixture: Fixture = agg.fixture(fixture_id)

    home_form = agg.team_form(fixture, True)
    away_form = agg.team_form(fixture, False)
    home_squad = agg.squad_report(fixture, True)
    away_squad = agg.squad_report(fixture, False)
    home_tactics = agg.tactical_profile(fixture, True)
    away_tactics = agg.tactical_profile(fixture, False)
    h2h = agg.head_to_head(fixture)
    home_venue = agg.venue_split(fixture, True)
    away_venue = agg.venue_split(fixture, False)
    motivation = agg.motivation(fixture)
    external = agg.external_factors(fixture)
    home_adv = agg.advanced_stats(fixture, True)
    away_adv = agg.advanced_stats(fixture, False)

    lam_h, lam_a = agg.base_lambdas(fixture)
    adj: AdjustmentResult = apply_adjustments(
        fixture, lam_h, lam_a, home_form, away_form, home_squad, away_squad,
        home_tactics, away_tactics, h2h, home_venue, away_venue, motivation, external,
    )

    ensemble = ModelEnsemble.instance()
    breakdown: list[ModelProbability] = ensemble.predict(
        adj.lambda_home, adj.lambda_away,
        form_edge=adj.form_edge, avail_edge=adj.availability_edge, mot_edge=adj.motivation_edge,
    )
    p_home, p_draw, p_away, agreement = ensemble.blend(breakdown)

    sim = simulate_match(
        adj.lambda_home, adj.lambda_away,
        cards_multiplier=adj.cards_multiplier,
        corners_multiplier=adj.corners_multiplier,
        referee=external.referee,
        home_scorers=home_squad.key_players,
        away_scorers=away_squad.key_players,
        seed=abs(hash(fixture_id)) % (2**31),
    )
    # media finale 1X2: 60% ensemble ML, 40% Monte Carlo empirico
    p_home = 0.6 * p_home + 0.4 * sim.p_home
    p_draw = 0.6 * p_draw + 0.4 * sim.p_draw
    p_away = 0.6 * p_away + 0.4 * sim.p_away
    total = p_home + p_draw + p_away
    p_home, p_draw, p_away = p_home / total, p_draw / total, p_away / total

    board = agg.odds_board(fixture)
    evaluations = _evaluate_markets(board, sim, p_home, p_draw, p_away, agreement, adj.data_quality)

    # riflette le probabilità finali nel riepilogo simulazione mostrato
    sim.p_home, sim.p_draw, sim.p_away = round(p_home, 4), round(p_draw, 4), round(p_away, 4)

    analysis = MatchAnalysis(
        fixture=fixture,
        home_form=home_form,
        away_form=away_form,
        home_squad=home_squad,
        away_squad=away_squad,
        home_tactics=home_tactics,
        away_tactics=away_tactics,
        tactical_verdict=adj.tactical_verdict,
        head_to_head=h2h,
        home_venue_split=home_venue,
        away_venue_split=away_venue,
        motivation=motivation,
        external=external,
        home_advanced=home_adv,
        away_advanced=away_adv,
        simulation=sim,
        model_breakdown=breakdown,
        odds_board=board,
        evaluations=evaluations,
        generated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        data_sources=agg.sources(),
    )
    # i fattori chiave restano nell'oggetto adjustments; il recommender li rilegge
    analysis_extra_factors[fixture_id] = adj
    with _cache_lock:
        _cache[fixture_id] = analysis
        if len(_cache) > 256:
            _cache.pop(next(iter(_cache)))
    return analysis


# fattori (favorevoli/rischio) calcolati durante l'analisi, indicizzati per fixture
analysis_extra_factors: dict[str, AdjustmentResult] = {}


def invalidate_cache(fixture_id: str | None = None) -> None:
    with _cache_lock:
        if fixture_id:
            _cache.pop(fixture_id, None)
            analysis_extra_factors.pop(fixture_id, None)
        else:
            _cache.clear()
            analysis_extra_factors.clear()
