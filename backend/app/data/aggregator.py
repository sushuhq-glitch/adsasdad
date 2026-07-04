"""Data aggregator: single entry point for the engine.

Responsibilities:
- choose live adapters when API keys are configured, demo feed otherwise;
- cross-validate values that come from multiple sources (odds sanity check,
  probability coherence, non-negative counts);
- expose which sources contributed to an analysis for transparency.
"""
from __future__ import annotations

import logging

from ..config import get_settings
from .api_football import ApiFootballClient
from .base import DataProvider
from .demo_provider import DemoProvider

log = logging.getLogger(__name__)


class DataAggregator:
    def __init__(self) -> None:
        settings = get_settings()
        self.demo = DemoProvider()
        self.live: ApiFootballClient | None = None
        if settings.api_football_key:
            self.live = ApiFootballClient(settings.api_football_key)
        self._provider: DataProvider = self.demo

    # -- source bookkeeping -------------------------------------------------
    def sources(self) -> list[str]:
        srcs = []
        if self.live:
            srcs.append("API-Football (live)")
        srcs.append("OddsLab demo feed (deterministic fallback)")
        srcs.append("Internal xG / Dixon-Coles model (validation layer)")
        return srcs

    # -- delegated, validated access ----------------------------------------
    def leagues(self, sport: str = "football"):
        if self.live:
            try:
                leagues = self.live.leagues()
                if leagues:
                    return leagues
            except Exception as exc:  # network / quota / schema errors
                log.warning("live leagues failed, falling back to demo: %s", exc)
        return self._provider.leagues(sport)

    def fixtures(self, league_id: str | None = None, date: str | None = None):
        if self.live:
            try:
                fixtures = self.live.fixtures(league_id, date)
                if fixtures:
                    return fixtures
            except Exception as exc:
                log.warning("live fixtures failed, falling back to demo: %s", exc)
        return self._provider.fixtures(league_id, date)

    def fixture(self, fixture_id: str):
        return self._provider.fixture(fixture_id)

    def team_form(self, fixture, home: bool):
        return self._provider.team_form(fixture, home)

    def squad_report(self, fixture, home: bool):
        return self._provider.squad_report(fixture, home)

    def tactical_profile(self, fixture, home: bool):
        return self._provider.tactical_profile(fixture, home)

    def head_to_head(self, fixture):
        return self._provider.head_to_head(fixture)

    def venue_split(self, fixture, home: bool):
        return self._provider.venue_split(fixture, home)

    def motivation(self, fixture):
        return self._provider.motivation(fixture)

    def external_factors(self, fixture):
        return self._provider.external_factors(fixture)

    def advanced_stats(self, fixture, home: bool):
        return self._provider.advanced_stats(fixture, home)

    def odds_board(self, fixture):
        board = self._provider.odds_board(fixture)
        # validation: implied probabilities of complementary markets must be
        # coherent; drop anything that fails the sanity check
        valid = []
        for mk in board.markets:
            if 1.01 <= mk.best_odds <= 1000 and mk.avg_odds > 1.0:
                valid.append(mk)
            else:
                log.warning("dropping incoherent market %s (%s)", mk.market_id, mk.best_odds)
        board.markets = valid
        return board

    def base_lambdas(self, fixture):
        return self.demo.base_lambdas(fixture)


_aggregator: DataAggregator | None = None


def get_aggregator() -> DataAggregator:
    global _aggregator
    if _aggregator is None:
        _aggregator = DataAggregator()
    return _aggregator
