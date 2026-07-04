export interface League {
  id: string
  name: string
  country: string
  sport: string
}

export interface Team {
  id: string
  name: string
  league_id: string
  attack: number
  defense: number
}

export interface Fixture {
  id: string
  league_id: string
  league_name: string
  home_team: Team
  away_team: Team
  kickoff_utc: string
  venue: string
  round: string
  importance: string
}

export interface FormWindow {
  matches: number
  wins: number
  draws: number
  losses: number
  goals_for: number
  goals_against: number
  xg_for: number
  xg_against: number
  shots: number
  shots_on_target: number
  big_chances_created: number
  big_chances_conceded: number
  possession_pct: number
  pass_accuracy_pct: number
  ppda: number
  recoveries: number
  corners_for: number
  corners_against: number
  yellow_cards: number
  red_cards: number
  points_per_game: number
  form_string: string
}

export interface TeamForm {
  team_id: string
  last5: FormWindow
  last10: FormWindow
  last20: FormWindow
}

export interface PlayerReport {
  name: string
  position: string
  status: string
  goals: number
  assists: number
  xg: number
  xa: number
  avg_rating: number
  fitness: number
  importance: number
}

export interface SquadReport {
  team_id: string
  injured: PlayerReport[]
  suspended: PlayerReport[]
  doubtful: PlayerReport[]
  yellow_card_risk: PlayerReport[]
  late_returns: PlayerReport[]
  key_players: PlayerReport[]
  probable_lineup: string[]
  formation: string
  official_lineup_available: boolean
  rotation_risk: number
  rest_days: number
  european_fixture_within_4_days: boolean
  fatigue_index: number
  availability_index: number
}

export interface TacticalProfile {
  team_id: string
  formation: string
  style: string
  pressing_intensity: number
  defensive_line_height: number
  counter_attack_threat: number
  crossing_volume: number
  set_piece_threat: number
  strengths: string[]
  weaknesses: string[]
}

export interface HeadToHeadWindow {
  matches: number
  home_team_wins: number
  draws: number
  away_team_wins: number
  avg_goals: number
  over25_pct: number
  under25_pct: number
  btts_pct: number
}

export interface HeadToHead {
  last5: HeadToHeadWindow
  last10: HeadToHeadWindow
  last20: HeadToHeadWindow
  recent_results: string[]
}

export interface VenueSplit {
  team_id: string
  home_ppg: number
  away_ppg: number
  home_goals_for_avg: number
  home_goals_against_avg: number
  away_goals_for_avg: number
  away_goals_against_avg: number
  home_advantage_index: number
}

export interface RefereeProfile {
  name: string
  matches_officiated: number
  avg_yellow_cards: number
  avg_red_cards: number
  avg_fouls: number
  penalties_per_match: number
  home_win_pct_officiated: number
}

export interface WeatherReport {
  condition: string
  temperature_c: number
  rain_mm: number
  snow: boolean
  wind_kmh: number
  humidity_pct: number
  pitch_condition: string
}

export interface ExternalFactors {
  weather: WeatherReport
  referee: RefereeProfile
  var_active: boolean
  away_travel_km: number
  expected_attendance: number
  stadium_capacity_pct: number
  crowd_factor: number
}

export interface MotivationReport {
  home_motivation: number
  away_motivation: number
  home_context: string
  away_context: string
  is_derby: boolean
  stakes: string
}

export interface AdvancedStats {
  team_id: string
  xg_per_game: number
  xa_per_game: number
  ppda: number
  possession_value_per_game: number
  deep_completions_per_game: number
  passes_into_final_third: number
  big_chances_per_game: number
  big_chances_conceded_per_game: number
  cross_accuracy_pct: number
  set_piece_goals_share_pct: number
  dangerous_attacks_per_game: number
  shot_zones: Record<string, number>
  pressure_zones: Record<string, number>
}

export interface BookmakerOdds {
  bookmaker: string
  odds: number
}

export interface MarketOdds {
  market_id: string
  market_group: string
  selection: string
  best_odds: number
  best_bookmaker: string
  avg_odds: number
  books: BookmakerOdds[]
  opening_odds: number
  movement_pct: number
  suspicious_move: boolean
}

export interface OddsTick {
  ts: string
  market_id: string
  odds: number
}

export interface OddsBoard {
  fixture_id: string
  markets: MarketOdds[]
  history: OddsTick[]
}

export interface ModelProbability {
  model: string
  p_home: number
  p_draw: number
  p_away: number
  weight: number
}

export interface SimulationSummary {
  n_simulations: number
  lambda_home: number
  lambda_away: number
  p_home: number
  p_draw: number
  p_away: number
  over_under: Record<string, number>
  btts: number
  exact_scores: Record<string, number>
  corners_avg: number
  corners_over_9_5: number
  cards_avg: number
  cards_over_4_5: number
  handicap: Record<string, number>
  team_totals: Record<string, number>
  top_scorers: Record<string, number>
}

export interface MarketEvaluation {
  market_id: string
  market_group: string
  selection: string
  fixture_label: string
  probability: number
  fair_odds: number
  best_odds: number
  best_bookmaker: string
  value_pct: number
  edge_over_market: number
  confidence: number
  kelly_fraction: number
}

export interface KeyFactor {
  kind: string
  title: string
  detail: string
  impact: number
}

export interface Recommendation {
  fixture: Fixture
  market: MarketEvaluation
  target_odds: number
  reliability: string
  reasoning: string
  favorable_factors: KeyFactor[]
  risk_factors: KeyFactor[]
  alternatives: MarketEvaluation[]
  model_breakdown: ModelProbability[]
  simulation: SimulationSummary
  disclaimer: string
}

export interface MatchAnalysis {
  fixture: Fixture
  home_form: TeamForm
  away_form: TeamForm
  home_squad: SquadReport
  away_squad: SquadReport
  home_tactics: TacticalProfile
  away_tactics: TacticalProfile
  tactical_verdict: string
  head_to_head: HeadToHead
  home_venue_split: VenueSplit
  away_venue_split: VenueSplit
  motivation: MotivationReport
  external: ExternalFactors
  home_advanced: AdvancedStats
  away_advanced: AdvancedStats
  simulation: SimulationSummary
  model_breakdown: ModelProbability[]
  odds_board: OddsBoard
  evaluations: MarketEvaluation[]
  generated_at: string
  data_sources: string[]
}

export interface HistoryEntry {
  id: number
  created_at: string
  fixture_id: string
  fixture_label: string
  kickoff_utc: string
  market_id: string
  selection: string
  target_odds: number
  taken_odds: number
  probability: number
  value_pct: number
  reliability: string
}
