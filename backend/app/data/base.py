"""Abstract data-provider interface.

Every source of truth (API-Football, Football-Data, Understat, StatsBomb,
Sportradar, bookmaker odds feeds, weather APIs...) is wrapped behind this
interface so the analysis engine never depends on a specific vendor.
Cross-validation between providers happens in ``aggregator.py``.
"""
from __future__ import annotations

import abc

from ..schemas import (
    AdvancedStats,
    ExternalFactors,
    Fixture,
    HeadToHead,
    League,
    MotivationReport,
    OddsBoard,
    SquadReport,
    TacticalProfile,
    TeamForm,
    VenueSplit,
)


class DataProvider(abc.ABC):
    name: str = "abstract"

    @abc.abstractmethod
    def leagues(self, sport: str = "football") -> list[League]: ...

    @abc.abstractmethod
    def fixtures(self, league_id: str | None = None, date: str | None = None) -> list[Fixture]: ...

    @abc.abstractmethod
    def fixture(self, fixture_id: str) -> Fixture: ...

    @abc.abstractmethod
    def team_form(self, fixture: Fixture, home: bool) -> TeamForm: ...

    @abc.abstractmethod
    def squad_report(self, fixture: Fixture, home: bool) -> SquadReport: ...

    @abc.abstractmethod
    def tactical_profile(self, fixture: Fixture, home: bool) -> TacticalProfile: ...

    @abc.abstractmethod
    def head_to_head(self, fixture: Fixture) -> HeadToHead: ...

    @abc.abstractmethod
    def venue_split(self, fixture: Fixture, home: bool) -> VenueSplit: ...

    @abc.abstractmethod
    def motivation(self, fixture: Fixture) -> MotivationReport: ...

    @abc.abstractmethod
    def external_factors(self, fixture: Fixture) -> ExternalFactors: ...

    @abc.abstractmethod
    def advanced_stats(self, fixture: Fixture, home: bool) -> AdvancedStats: ...

    @abc.abstractmethod
    def odds_board(self, fixture: Fixture) -> OddsBoard: ...
