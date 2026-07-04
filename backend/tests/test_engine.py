"""Test end-to-end del motore: dati, modelli, simulazione, raccomandazioni, API."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from app.analysis import probability as pr
from app.data.aggregator import get_aggregator
from app.engine.analyzer import analyze_fixture
from app.engine.recommender import recommend
from app.main import app
from app.ml.ensemble import ModelEnsemble
from app.schemas import RecommendRequest
from app.simulation.monte_carlo import simulate_match


@pytest.fixture(scope="module")
def any_fixture():
    fixtures = get_aggregator().fixtures()
    assert fixtures, "il provider demo deve sempre restituire partite nei prossimi 7 giorni"
    return fixtures[0]


def test_probability_matrix_coherence():
    m = pr.score_matrix(1.6, 1.1)
    ph, pd_, pa = pr.outcome_probs(m)
    assert abs(ph + pd_ + pa - 1.0) < 1e-6
    assert pr.over_prob(m, 0.5) > pr.over_prob(m, 2.5) > pr.over_prob(m, 4.5)
    assert 0 < pr.btts_prob(m) < 1


def test_simulation_matches_analytics():
    sim = simulate_match(1.6, 1.1, n=100_000, seed=7)
    m = pr.score_matrix(1.6, 1.1)
    ph, _, _ = pr.outcome_probs(m)
    assert sim.n_simulations == 100_000
    assert abs(sim.p_home - ph) < 0.05  # la correlazione sposta poco le medie
    assert abs(sim.over_under["2.5"] - pr.over_prob(m, 2.5)) < 0.06
    assert sum(sim.exact_scores.values()) > 0.5


def test_ensemble_probabilities_normalised():
    ens = ModelEnsemble.instance()
    breakdown = ens.predict(1.8, 1.0)
    assert len(breakdown) >= 5  # RF, GB, ExtraTrees, NN, Dixon-Coles
    for mp in breakdown:
        assert abs(mp.p_home + mp.p_draw + mp.p_away - 1.0) < 0.02
    ph, pd_, pa, agreement = ens.blend(breakdown)
    assert abs(ph + pd_ + pa - 1.0) < 1e-6
    assert ph > pa  # 1.8 vs 1.0 xG: la squadra di casa deve essere favorita
    assert 0 <= agreement <= 1


def test_analysis_is_deterministic_and_complete(any_fixture):
    a1 = analyze_fixture(any_fixture.id, use_cache=False)
    a2 = analyze_fixture(any_fixture.id, use_cache=False)
    assert a1.simulation.p_home == a2.simulation.p_home
    assert a1.evaluations, "devono esserci mercati valutati"
    assert a1.home_form.last5.matches == 5
    assert a1.home_form.last20.matches == 20
    assert len(a1.odds_board.markets) >= 25
    for ev in a1.evaluations:
        assert 0 < ev.probability < 1
        assert ev.fair_odds >= 1.0


def test_recommendation_respects_target_odds(any_fixture):
    req = RecommendRequest(fixture_id=any_fixture.id, target_odds=1.5, tolerance_pct=15)
    rec = recommend(req)
    assert rec is not None
    lo, hi = 1.5 * 0.85, 1.5 * 1.15
    assert lo <= rec.market.best_odds <= hi
    # nessuna alternativa può avere probabilità più alta della scelta principale
    for alt in rec.alternatives:
        assert alt.probability <= rec.market.probability + 1e-9
    assert rec.reasoning
    assert rec.risk_factors
    assert "certa" in rec.disclaimer or "certezza" in rec.disclaimer


def test_api_endpoints(tmp_path, monkeypatch, any_fixture):
    from app import config
    monkeypatch.setattr(config.get_settings(), "history_db_path", str(tmp_path / "h.sqlite3"))
    with TestClient(app) as client:
        assert client.get("/api/health").json()["status"] == "ok"
        leagues = client.get("/api/leagues").json()
        assert any(lg["id"] == "serie-a" for lg in leagues)
        fixtures = client.get("/api/fixtures", params={"league_id": "serie-a"}).json()
        assert isinstance(fixtures, list)
        r = client.get(f"/api/analysis/{any_fixture.id}")
        assert r.status_code == 200
        body = r.json()
        assert body["simulation"]["n_simulations"] >= 100_000
        rec = client.post("/api/recommend", json={"target_odds": 1.5, "fixture_id": any_fixture.id})
        assert rec.status_code == 200
        assert rec.json()["market"]["probability"] > 0
        hist = client.get("/api/history").json()
        assert len(hist) >= 1
        bad = client.post("/api/recommend", json={"target_odds": 0.5})
        assert bad.status_code == 422
