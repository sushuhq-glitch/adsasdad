"""OddsLab — API REST.

Avvio locale (solo API):
    uvicorn app.main:app --reload --port 8000

Avvio "tutto in uno" (API + interfaccia web, raggiungibile anche da telefono
sulla stessa rete): compila prima il frontend (`npm run build` in frontend/),
poi:
    uvicorn app.main:app --host 0.0.0.0 --port 8000
e apri http://<ip-del-pc>:8000 dal telefono.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .data.aggregator import get_aggregator
from .engine import history
from .engine.analyzer import analyze_fixture, invalidate_cache
from .engine.recommender import recommend
from .ml.ensemble import ModelEnsemble
from .schemas import (
    Fixture,
    HistoryEntry,
    League,
    MatchAnalysis,
    Recommendation,
    RecommendRequest,
)

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("oddslab")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # addestra l'ensemble una sola volta all'avvio
    ModelEnsemble.instance()
    log.info("ensemble pronto: %s", ModelEnsemble.instance().training_report)
    yield


settings = get_settings()
app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

api = settings.api_prefix


@app.get(f"{api}/health")
def health() -> dict:
    ens = ModelEnsemble.instance()
    return {
        "status": "ok",
        "models_trained": ens.trained,
        "training_log_loss": ens.training_report,
        "n_simulations": settings.n_simulations,
        "live_providers": bool(settings.api_football_key),
    }


@app.get(f"{api}/leagues", response_model=list[League])
def leagues(sport: str = "football") -> list[League]:
    return get_aggregator().leagues(sport)


@app.get(f"{api}/fixtures", response_model=list[Fixture])
def fixtures(
    league_id: str | None = Query(default=None),
    date: str | None = Query(default=None, description="YYYY-MM-DD"),
) -> list[Fixture]:
    return get_aggregator().fixtures(league_id, date)


@app.get(f"{api}/analysis/{{fixture_id:path}}", response_model=MatchAnalysis)
def analysis(fixture_id: str) -> MatchAnalysis:
    try:
        return analyze_fixture(fixture_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Partita non trovata")


@app.post(f"{api}/refresh/{{fixture_id:path}}", response_model=MatchAnalysis)
def refresh(fixture_id: str) -> MatchAnalysis:
    """Aggiornamento in tempo reale: invalida la cache (formazioni ufficiali,
    infortuni, quote, meteo) e ricalcola immediatamente tutte le probabilità."""
    invalidate_cache(fixture_id)
    try:
        return analyze_fixture(fixture_id, use_cache=False)
    except KeyError:
        raise HTTPException(status_code=404, detail="Partita non trovata")


@app.post(f"{api}/recommend", response_model=Recommendation)
def recommend_bet(req: RecommendRequest) -> Recommendation:
    if not (1.01 <= req.target_odds <= 100):
        raise HTTPException(status_code=422, detail="La quota deve essere tra 1.01 e 100")
    rec = recommend(req)
    if rec is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "Nessun mercato compatibile con la quota richiesta nell'intervallo di tolleranza. "
                "Prova ad allargare la tolleranza o a cambiare data/campionato."
            ),
        )
    history.record(rec)
    return rec


@app.get(f"{api}/history", response_model=list[HistoryEntry])
def prediction_history(limit: int = 50) -> list[HistoryEntry]:
    return history.list_entries(limit)


# ---------------------------------------------------------------------------
# Modalità "tutto in uno": se il frontend è stato compilato (frontend/dist),
# il backend lo serve direttamente. Basta un solo processo per usare la web
# app anche da telefono/tablet sulla stessa rete.
# ---------------------------------------------------------------------------
_frontend_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if _frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=_frontend_dist, html=True), name="frontend")
    log.info("frontend servito da %s", _frontend_dist)
