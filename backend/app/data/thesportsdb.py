"""Adapter TheSportsDB (piano gratuito, senza chiave) per il calendario
REALE della FIFA World Cup 2026.

Fornisce le partite effettive del torneo (tabellone, date, stadi) tramite
l'endpoint pubblico ``eventsday``. Tutte le altre dimensioni (forma, rose,
tattica, quote...) restano generate dal provider deterministico a partire
dall'identità della partita reale, finché non vengono configurate API a
pagamento (API-Football, The Odds API).
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timedelta, timezone

import httpx

from ..schemas import Fixture, Team

log = logging.getLogger(__name__)

BASE_URL = "https://www.thesportsdb.com/api/v1/json/3"
WORLD_CUP_LEAGUE_ID = 4429
CACHE_TTL_SECONDS = 600

# nome inglese (come restituito dall'API) -> (nome italiano, attacco, difesa)
NATIONAL_RATINGS: dict[str, tuple[str, float, float]] = {
    "Argentina": ("Argentina", 0.90, 0.84), "France": ("Francia", 0.90, 0.82),
    "Spain": ("Spagna", 0.88, 0.82), "England": ("Inghilterra", 0.84, 0.82),
    "Brazil": ("Brasile", 0.86, 0.76), "Portugal": ("Portogallo", 0.84, 0.76),
    "Germany": ("Germania", 0.80, 0.72), "Netherlands": ("Olanda", 0.78, 0.76),
    "Italy": ("Italia", 0.72, 0.80), "Belgium": ("Belgio", 0.74, 0.68),
    "Croatia": ("Croazia", 0.70, 0.70), "Uruguay": ("Uruguay", 0.70, 0.72),
    "Morocco": ("Marocco", 0.66, 0.76), "Colombia": ("Colombia", 0.70, 0.68),
    "USA": ("Stati Uniti", 0.64, 0.64), "United States": ("Stati Uniti", 0.64, 0.64),
    "Mexico": ("Messico", 0.62, 0.64), "Japan": ("Giappone", 0.66, 0.66),
    "Senegal": ("Senegal", 0.64, 0.62), "Switzerland": ("Svizzera", 0.60, 0.68),
    "Denmark": ("Danimarca", 0.62, 0.64), "Ecuador": ("Ecuador", 0.58, 0.64),
    "South Korea": ("Corea del Sud", 0.58, 0.56), "Australia": ("Australia", 0.52, 0.58),
    "Canada": ("Canada", 0.56, 0.54), "Norway": ("Norvegia", 0.68, 0.58),
    "Austria": ("Austria", 0.60, 0.60), "Turkey": ("Turchia", 0.62, 0.56),
    "Egypt": ("Egitto", 0.56, 0.60), "Nigeria": ("Nigeria", 0.60, 0.54),
    "Paraguay": ("Paraguay", 0.50, 0.60), "Costa Rica": ("Costa Rica", 0.46, 0.56),
    "Panama": ("Panama", 0.44, 0.50), "Ghana": ("Ghana", 0.56, 0.54),
    "Ivory Coast": ("Costa d'Avorio", 0.60, 0.58), "Algeria": ("Algeria", 0.56, 0.58),
    "Tunisia": ("Tunisia", 0.50, 0.56), "Poland": ("Polonia", 0.58, 0.58),
    "Ukraine": ("Ucraina", 0.58, 0.58), "Scotland": ("Scozia", 0.52, 0.56),
    "Serbia": ("Serbia", 0.58, 0.56), "Iran": ("Iran", 0.50, 0.58),
    "Saudi Arabia": ("Arabia Saudita", 0.46, 0.52), "Qatar": ("Qatar", 0.44, 0.50),
    "Uzbekistan": ("Uzbekistan", 0.44, 0.50), "Jordan": ("Giordania", 0.42, 0.50),
    "New Zealand": ("Nuova Zelanda", 0.42, 0.48), "Peru": ("Perù", 0.50, 0.56),
    "Chile": ("Cile", 0.52, 0.54), "Venezuela": ("Venezuela", 0.46, 0.52),
    "Cape Verde": ("Capo Verde", 0.44, 0.50), "Curacao": ("Curaçao", 0.40, 0.46),
    "Haiti": ("Haiti", 0.38, 0.44), "Honduras": ("Honduras", 0.42, 0.48),
    "Jamaica": ("Giamaica", 0.44, 0.48), "South Africa": ("Sudafrica", 0.46, 0.50),
}

ROUND_LABELS = {
    "1": "Fase a gironi", "2": "Fase a gironi", "3": "Fase a gironi",
    "16": "Ottavi di finale", "32": "Sedicesimi di finale",
    "125": "Quarti di finale", "150": "Semifinale",
    "160": "Finale 3° posto", "200": "Finale",
}


def _slug(name: str) -> str:
    return name.lower().replace(" ", "-").replace(".", "").replace("'", "")


def _event_to_fixture(ev: dict) -> Fixture | None:
    """Converte un evento TheSportsDB in Fixture interno. None se non valido
    o già concluso (non ha senso scommetterci)."""
    home_en = ev.get("strHomeTeam") or ""
    away_en = ev.get("strAwayTeam") or ""
    ts = ev.get("strTimestamp") or ""
    if not home_en or not away_en or not ts:
        return None
    if ev.get("intHomeScore") is not None:  # partita finita o in corso con risultato
        return None
    home_it, h_att, h_def = NATIONAL_RATINGS.get(home_en, (home_en, 0.5, 0.5))
    away_it, a_att, a_def = NATIONAL_RATINGS.get(away_en, (away_en, 0.5, 0.5))
    date = ts[:10]
    return Fixture(
        id=f"world-cup|{date}|{_slug(home_it)}|{_slug(away_it)}",
        league_id="world-cup",
        league_name="FIFA World Cup 2026",
        home_team=Team(id=f"world-cup:{_slug(home_it)}", name=home_it,
                       league_id="world-cup", attack=h_att, defense=h_def),
        away_team=Team(id=f"world-cup:{_slug(away_it)}", name=away_it,
                       league_id="world-cup", attack=a_att, defense=a_def),
        kickoff_utc=ts if ts.endswith("Z") else f"{ts}Z",
        venue=ev.get("strVenue") or "Sede da confermare",
        round=ROUND_LABELS.get(str(ev.get("intRound") or ""), f"Round {ev.get('intRound')}"),
        importance="knockout",
    )


class WorldCupLiveProvider:
    """Calendario reale del Mondiale con cache TTL per giornata."""

    name = "thesportsdb-worldcup"

    def __init__(self, timeout: float = 10.0):
        self.timeout = timeout
        self._cache: dict[str, tuple[float, list[Fixture]]] = {}
        self._lock = threading.Lock()

    def _fetch_day(self, date: str) -> list[Fixture]:
        with self._lock:
            hit = self._cache.get(date)
            if hit and time.time() - hit[0] < CACHE_TTL_SECONDS:
                return hit[1]
        resp = httpx.get(
            f"{BASE_URL}/eventsday.php",
            params={"d": date, "l": WORLD_CUP_LEAGUE_ID},
            timeout=self.timeout,
        )
        resp.raise_for_status()
        events = resp.json().get("events") or []
        fixtures = [fx for fx in (_event_to_fixture(e) for e in events) if fx]
        with self._lock:
            self._cache[date] = (time.time(), fixtures)
        return fixtures

    def fixtures(self, date: str | None = None) -> list[Fixture]:
        """Partite reali del Mondiale per la data indicata o i prossimi 7 giorni.
        Solleva eccezioni di rete: il chiamante decide il fallback."""
        if date:
            days = [date]
        else:
            today = datetime.now(timezone.utc).date()
            days = [(today + timedelta(days=i)).isoformat() for i in range(7)]
        out: list[Fixture] = []
        for day in days:
            out.extend(self._fetch_day(day))
        out.sort(key=lambda f: f.kickoff_utc)
        return out

    def fixture(self, fixture_id: str) -> Fixture | None:
        """Risolve un id fixture reale ricaricando la giornata corrispondente."""
        try:
            _, date, _, _ = fixture_id.split("|")
        except ValueError:
            return None
        try:
            for fx in self._fetch_day(date):
                if fx.id == fixture_id:
                    return fx
        except Exception as exc:
            log.warning("thesportsdb fixture lookup failed: %s", exc)
        return None
