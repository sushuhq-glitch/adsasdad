"""API-Football (api-sports.io) adapter.

Activated automatically when ``ODDSLAB_API_FOOTBALL_KEY`` is set. It maps the
live REST endpoints for leagues, fixtures, injuries, lineups, head-to-head
and bookmaker odds onto the internal schemas. Anything the vendor does not
expose (e.g. proprietary pressure maps) is enriched by the fallback provider
through the aggregator, and every payload is validated before use.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

import httpx

from ..schemas import Fixture, League, Team

log = logging.getLogger(__name__)

BASE_URL = "https://v3.football.api-sports.io"

# API-Football league ids for the competitions bundled in the demo universe
LEAGUE_MAP = {
    "serie-a": 135,
    "premier-league": 39,
    "la-liga": 140,
    "bundesliga": 78,
    "ligue-1": 61,
    "champions-league": 2,
}


class ApiFootballClient:
    """Thin, validated client. Raises on any malformed payload so the
    aggregator can fall back to another source instead of silently using
    unverified data."""

    name = "api-football"

    def __init__(self, api_key: str, timeout: float = 12.0):
        self.api_key = api_key
        self.timeout = timeout

    def _get(self, path: str, params: dict | None = None) -> list:
        with httpx.Client(timeout=self.timeout) as client:
            resp = client.get(
                f"{BASE_URL}{path}",
                params=params or {},
                headers={"x-apisports-key": self.api_key},
            )
            resp.raise_for_status()
            payload = resp.json()
        if payload.get("errors"):
            raise RuntimeError(f"api-football error: {payload['errors']}")
        body = payload.get("response")
        if body is None:
            raise RuntimeError("api-football: missing response body")
        return body

    def leagues(self) -> list[League]:
        out = []
        for slug, vendor_id in LEAGUE_MAP.items():
            rows = self._get("/leagues", {"id": vendor_id})
            for row in rows:
                out.append(
                    League(
                        id=slug,
                        name=row["league"]["name"],
                        country=row["country"]["name"],
                    )
                )
        return out

    def fixtures(self, league_id: str | None = None, date: str | None = None) -> list[Fixture]:
        date = date or datetime.now(timezone.utc).date().isoformat()
        slugs = [league_id] if league_id else list(LEAGUE_MAP)
        season = int(date[:4])
        fixtures: list[Fixture] = []
        for slug in slugs:
            rows = self._get(
                "/fixtures",
                {"league": LEAGUE_MAP[slug], "date": date, "season": season},
            )
            for row in rows:
                home = row["teams"]["home"]
                away = row["teams"]["away"]
                fixtures.append(
                    Fixture(
                        id=f"{slug}|{date}|af{row['fixture']['id']}",
                        league_id=slug,
                        league_name=row["league"]["name"],
                        home_team=Team(id=f"af:{home['id']}", name=home["name"], league_id=slug),
                        away_team=Team(id=f"af:{away['id']}", name=away["name"], league_id=slug),
                        kickoff_utc=row["fixture"]["date"],
                        venue=(row["fixture"].get("venue") or {}).get("name") or "TBD",
                        round=row["league"].get("round", ""),
                    )
                )
        return fixtures

    def injuries(self, vendor_fixture_id: int) -> list[dict]:
        return self._get("/injuries", {"fixture": vendor_fixture_id})

    def lineups(self, vendor_fixture_id: int) -> list[dict]:
        return self._get("/fixtures/lineups", {"fixture": vendor_fixture_id})

    def head_to_head(self, home_vendor_id: int, away_vendor_id: int) -> list[dict]:
        return self._get("/fixtures/headtohead", {"h2h": f"{home_vendor_id}-{away_vendor_id}"})

    def odds(self, vendor_fixture_id: int) -> list[dict]:
        return self._get("/odds", {"fixture": vendor_fixture_id})
