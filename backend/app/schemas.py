"""Pydantic schemas shared by the data layer, engine and REST API."""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Core entities
# ---------------------------------------------------------------------------
class League(BaseModel):
    id: str
    name: str
    country: str
    sport: str = "football"


class Team(BaseModel):
    id: str
    name: str
    league_id: str
    # latent strength ratings used by models (0..1 scale, 0.5 = average)
    attack: float = 0.5
    defense: float = 0.5


class Fixture(BaseModel):
    id: str
    league_id: str
    league_name: str
    home_team: Team
    away_team: Team
    kickoff_utc: str
    venue: str
    round: str = ""
    importance: str = "regular"  # derby / title race / relegation / final ...


# ---------------------------------------------------------------------------
# Form & statistics
# ---------------------------------------------------------------------------
class FormWindow(BaseModel):
    """Aggregate statistics over the last N matches."""

    matches: int
    wins: int
    draws: int
    losses: int
    goals_for: int
    goals_against: int
    xg_for: float
    xg_against: float
    shots: float
    shots_on_target: float
    big_chances_created: float
    big_chances_conceded: float
    possession_pct: float
    pass_accuracy_pct: float
    ppda: float  # passes allowed per defensive action (lower = higher pressing)
    recoveries: float
    corners_for: float
    corners_against: float
    yellow_cards: float
    red_cards: float
    points_per_game: float
    form_string: str  # e.g. "WWDLW"


class TeamForm(BaseModel):
    team_id: str
    last5: FormWindow
    last10: FormWindow
    last20: FormWindow


class PlayerReport(BaseModel):
    name: str
    position: str
    status: str  # available / injured / suspended / doubtful / yellow-card risk
    goals: int = 0
    assists: int = 0
    xg: float = 0.0
    xa: float = 0.0
    pass_accuracy_pct: float = 0.0
    shot_accuracy_pct: float = 0.0
    tackles_won_pct: float = 0.0
    dribbles_success_pct: float = 0.0
    fouls_per_game: float = 0.0
    cards: int = 0
    avg_rating: float = 6.0
    recent_minutes_pct: float = 100.0  # share of available minutes played
    fitness: float = 1.0  # 0..1
    importance: float = 0.5  # contribution weight to team strength


class SquadReport(BaseModel):
    team_id: str
    injured: list[PlayerReport] = Field(default_factory=list)
    suspended: list[PlayerReport] = Field(default_factory=list)
    doubtful: list[PlayerReport] = Field(default_factory=list)
    yellow_card_risk: list[PlayerReport] = Field(default_factory=list)
    late_returns: list[PlayerReport] = Field(default_factory=list)
    key_players: list[PlayerReport] = Field(default_factory=list)
    probable_lineup: list[str] = Field(default_factory=list)
    formation: str = "4-3-3"
    official_lineup_available: bool = False
    rotation_risk: float = 0.0  # 0..1
    rest_days: int = 7
    european_fixture_within_4_days: bool = False
    fatigue_index: float = 0.0  # 0..1, higher = more tired
    availability_index: float = 1.0  # 0..1, share of full-strength XI available


class TacticalProfile(BaseModel):
    team_id: str
    formation: str
    style: str  # possession / counter / high-press / low-block / direct
    pressing_intensity: float  # 0..1
    defensive_line_height: float  # 0..1
    counter_attack_threat: float  # 0..1
    crossing_volume: float  # 0..1
    set_piece_threat: float  # 0..1
    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)


class HeadToHeadWindow(BaseModel):
    matches: int
    home_team_wins: int
    draws: int
    away_team_wins: int
    avg_goals: float
    over25_pct: float
    under25_pct: float
    btts_pct: float


class HeadToHead(BaseModel):
    last5: HeadToHeadWindow
    last10: HeadToHeadWindow
    last20: HeadToHeadWindow
    recent_results: list[str] = Field(default_factory=list)  # "2-1", "0-0", ...


class VenueSplit(BaseModel):
    team_id: str
    home_ppg: float
    away_ppg: float
    home_goals_for_avg: float
    home_goals_against_avg: float
    away_goals_for_avg: float
    away_goals_against_avg: float
    home_advantage_index: float  # how much better at home than away


class RefereeProfile(BaseModel):
    name: str
    matches_officiated: int
    avg_yellow_cards: float
    avg_red_cards: float
    avg_fouls: float
    penalties_per_match: float
    home_win_pct_officiated: float


class WeatherReport(BaseModel):
    condition: str  # clear / rain / snow / wind / fog
    temperature_c: float
    rain_mm: float
    snow: bool
    wind_kmh: float
    humidity_pct: float
    pitch_condition: str  # excellent / good / heavy / poor


class ExternalFactors(BaseModel):
    weather: WeatherReport
    referee: RefereeProfile
    var_active: bool = True
    home_travel_km: float = 0.0
    away_travel_km: float = 0.0
    timezone_shift_hours: int = 0
    expected_attendance: int = 0
    stadium_capacity_pct: float = 0.0
    crowd_factor: float = 0.5  # 0..1 hostile/supportive index


class MotivationReport(BaseModel):
    home_motivation: float  # 0..1
    away_motivation: float
    home_context: str
    away_context: str
    is_derby: bool = False
    stakes: str = "regular"


class AdvancedStats(BaseModel):
    team_id: str
    xg_per_game: float
    xa_per_game: float
    ppda: float
    possession_value_per_game: float
    deep_completions_per_game: float
    passes_into_final_third: float
    big_chances_per_game: float
    big_chances_conceded_per_game: float
    cross_accuracy_pct: float
    set_piece_goals_share_pct: float
    dangerous_attacks_per_game: float
    shot_zones: dict[str, float] = Field(default_factory=dict)  # box/outside/six-yard shares
    pressure_zones: dict[str, float] = Field(default_factory=dict)  # low/mid/high thirds


# ---------------------------------------------------------------------------
# Odds market
# ---------------------------------------------------------------------------
class BookmakerOdds(BaseModel):
    bookmaker: str
    odds: float


class MarketOdds(BaseModel):
    market_id: str  # e.g. "1X2:HOME", "OU:2.5:OVER"
    market_group: str  # 1X2, Double Chance, Over/Under, BTTS, ...
    selection: str  # human readable
    best_odds: float
    best_bookmaker: str
    avg_odds: float
    books: list[BookmakerOdds] = Field(default_factory=list)
    opening_odds: float = 0.0
    movement_pct: float = 0.0  # (best - opening) / opening
    suspicious_move: bool = False


class OddsTick(BaseModel):
    ts: str
    market_id: str
    odds: float


class OddsBoard(BaseModel):
    fixture_id: str
    markets: list[MarketOdds]
    history: list[OddsTick] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Model / simulation outputs
# ---------------------------------------------------------------------------
class ModelProbability(BaseModel):
    model: str
    p_home: float
    p_draw: float
    p_away: float
    weight: float


class SimulationSummary(BaseModel):
    n_simulations: int
    lambda_home: float
    lambda_away: float
    p_home: float
    p_draw: float
    p_away: float
    over_under: dict[str, float]  # {"0.5": pOver, ...}
    btts: float
    exact_scores: dict[str, float]  # top scorelines
    corners_avg: float
    corners_over_9_5: float
    cards_avg: float
    cards_over_4_5: float
    handicap: dict[str, float]  # asian handicap cover probabilities
    team_totals: dict[str, float]
    top_scorers: dict[str, float] = Field(default_factory=dict)  # anytime scorer probs


class MarketEvaluation(BaseModel):
    market_id: str
    market_group: str
    selection: str
    probability: float  # model estimated probability
    fair_odds: float
    best_odds: float
    best_bookmaker: str
    value_pct: float  # expected value margin: p*odds - 1
    edge_over_market: float  # our prob - implied prob (de-vigged)
    confidence: float  # 0..1 model agreement / data quality
    kelly_fraction: float


class KeyFactor(BaseModel):
    kind: str  # favorable / risk
    title: str
    detail: str
    impact: float  # -1..1


class Recommendation(BaseModel):
    fixture: Fixture
    market: MarketEvaluation
    target_odds: float
    reliability: str  # Very High / High / Medium / Low
    reasoning: str
    favorable_factors: list[KeyFactor]
    risk_factors: list[KeyFactor]
    alternatives: list[MarketEvaluation]
    model_breakdown: list[ModelProbability]
    simulation: SimulationSummary
    disclaimer: str


class MatchAnalysis(BaseModel):
    fixture: Fixture
    home_form: TeamForm
    away_form: TeamForm
    home_squad: SquadReport
    away_squad: SquadReport
    home_tactics: TacticalProfile
    away_tactics: TacticalProfile
    tactical_verdict: str
    head_to_head: HeadToHead
    home_venue_split: VenueSplit
    away_venue_split: VenueSplit
    motivation: MotivationReport
    external: ExternalFactors
    home_advanced: AdvancedStats
    away_advanced: AdvancedStats
    simulation: SimulationSummary
    model_breakdown: list[ModelProbability]
    odds_board: OddsBoard
    evaluations: list[MarketEvaluation]
    generated_at: str
    data_sources: list[str]


class RecommendRequest(BaseModel):
    sport: str = "football"
    league_id: Optional[str] = None
    fixture_id: Optional[str] = None
    date: Optional[str] = None  # YYYY-MM-DD
    target_odds: float = 1.5
    tolerance_pct: float = 12.0  # accept odds within +- tolerance of the target
    min_confidence: float = 0.0


class HistoryEntry(BaseModel):
    id: int
    created_at: str
    fixture_id: str
    fixture_label: str
    kickoff_utc: str
    market_id: str
    selection: str
    target_odds: float
    taken_odds: float
    probability: float
    value_pct: float
    reliability: str
