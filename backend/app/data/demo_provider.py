"""Deterministic demo data provider.

Generates realistic, internally-consistent football data (form, squads,
tactics, head-to-head, venue splits, referees, weather, advanced stats and a
multi-bookmaker odds board) without external APIs. Everything is seeded from
the fixture identity, so repeated calls return identical data — which makes
the whole pipeline reproducible and testable.

When real provider keys are configured (API-Football, The Odds API, ...)
the aggregator prefers live adapters and uses this provider as fallback.
"""
from __future__ import annotations

import hashlib
import random
from datetime import datetime, timedelta, timezone

from ..analysis import probability as pr
from ..schemas import (
    AdvancedStats,
    BookmakerOdds,
    ExternalFactors,
    Fixture,
    FormWindow,
    HeadToHead,
    HeadToHeadWindow,
    League,
    MarketOdds,
    MotivationReport,
    OddsBoard,
    OddsTick,
    PlayerReport,
    RefereeProfile,
    SquadReport,
    TacticalProfile,
    Team,
    TeamForm,
    VenueSplit,
    WeatherReport,
)
from .base import DataProvider

# ---------------------------------------------------------------------------
# Static universe
# ---------------------------------------------------------------------------
LEAGUES = [
    League(id="serie-a", name="Serie A", country="Italy"),
    League(id="premier-league", name="Premier League", country="England"),
    League(id="la-liga", name="La Liga", country="Spain"),
    League(id="bundesliga", name="Bundesliga", country="Germany"),
    League(id="ligue-1", name="Ligue 1", country="France"),
    League(id="champions-league", name="UEFA Champions League", country="Europe"),
]

# (name, attack, defense) — ratings on a 0..1 scale, 0.5 = league average
TEAMS: dict[str, list[tuple[str, float, float]]] = {
    "serie-a": [
        ("Inter", 0.86, 0.84), ("Napoli", 0.80, 0.78), ("Juventus", 0.72, 0.82),
        ("Milan", 0.78, 0.68), ("Atalanta", 0.82, 0.70), ("Roma", 0.68, 0.66),
        ("Lazio", 0.64, 0.62), ("Fiorentina", 0.66, 0.64), ("Bologna", 0.62, 0.68),
        ("Torino", 0.52, 0.62), ("Udinese", 0.48, 0.52), ("Genoa", 0.44, 0.54),
        ("Cagliari", 0.42, 0.46), ("Verona", 0.40, 0.44), ("Lecce", 0.38, 0.42),
        ("Empoli", 0.36, 0.44), ("Parma", 0.46, 0.42), ("Como", 0.50, 0.46),
        ("Monza", 0.38, 0.40), ("Venezia", 0.36, 0.38),
    ],
    "premier-league": [
        ("Manchester City", 0.90, 0.82), ("Arsenal", 0.84, 0.86), ("Liverpool", 0.88, 0.80),
        ("Chelsea", 0.76, 0.70), ("Tottenham", 0.74, 0.60), ("Manchester United", 0.66, 0.64),
        ("Newcastle", 0.72, 0.68), ("Aston Villa", 0.70, 0.64), ("Brighton", 0.66, 0.58),
        ("West Ham", 0.56, 0.52), ("Brentford", 0.58, 0.54), ("Fulham", 0.56, 0.56),
        ("Crystal Palace", 0.54, 0.62), ("Bournemouth", 0.58, 0.52), ("Everton", 0.46, 0.60),
        ("Wolves", 0.48, 0.46), ("Nottingham Forest", 0.56, 0.60), ("Leicester", 0.42, 0.40),
        ("Ipswich", 0.38, 0.38), ("Southampton", 0.36, 0.36),
    ],
    "la-liga": [
        ("Real Madrid", 0.90, 0.80), ("Barcelona", 0.88, 0.74), ("Atletico Madrid", 0.76, 0.84),
        ("Athletic Club", 0.68, 0.72), ("Real Sociedad", 0.62, 0.66), ("Villarreal", 0.70, 0.58),
        ("Real Betis", 0.60, 0.58), ("Sevilla", 0.54, 0.52), ("Valencia", 0.50, 0.56),
        ("Girona", 0.62, 0.52), ("Osasuna", 0.50, 0.54), ("Celta Vigo", 0.54, 0.48),
        ("Mallorca", 0.44, 0.56), ("Rayo Vallecano", 0.48, 0.50), ("Getafe", 0.40, 0.58),
        ("Alaves", 0.42, 0.46), ("Espanyol", 0.40, 0.44), ("Leganes", 0.36, 0.42),
        ("Las Palmas", 0.42, 0.38), ("Valladolid", 0.34, 0.36),
    ],
    "bundesliga": [
        ("Bayern Munich", 0.92, 0.78), ("Bayer Leverkusen", 0.84, 0.76), ("Borussia Dortmund", 0.78, 0.64),
        ("RB Leipzig", 0.74, 0.68), ("Eintracht Frankfurt", 0.70, 0.60), ("Stuttgart", 0.72, 0.58),
        ("Freiburg", 0.58, 0.60), ("Hoffenheim", 0.56, 0.46), ("Wolfsburg", 0.56, 0.52),
        ("Borussia Monchengladbach", 0.56, 0.50), ("Mainz", 0.54, 0.58), ("Augsburg", 0.46, 0.50),
        ("Werder Bremen", 0.52, 0.46), ("Union Berlin", 0.44, 0.54), ("Bochum", 0.38, 0.36),
        ("Heidenheim", 0.42, 0.40), ("St. Pauli", 0.40, 0.48), ("Holstein Kiel", 0.38, 0.34),
    ],
    "ligue-1": [
        ("PSG", 0.92, 0.80), ("Monaco", 0.76, 0.64), ("Marseille", 0.74, 0.62),
        ("Lille", 0.66, 0.68), ("Lyon", 0.68, 0.58), ("Nice", 0.60, 0.64),
        ("Lens", 0.58, 0.62), ("Rennes", 0.58, 0.54), ("Strasbourg", 0.56, 0.50),
        ("Toulouse", 0.50, 0.54), ("Brest", 0.54, 0.50), ("Reims", 0.46, 0.48),
        ("Nantes", 0.42, 0.44), ("Auxerre", 0.46, 0.42), ("Angers", 0.38, 0.40),
        ("Le Havre", 0.36, 0.38), ("Saint-Etienne", 0.40, 0.36), ("Montpellier", 0.36, 0.34),
    ],
    "champions-league": [
        ("Real Madrid", 0.90, 0.80), ("Manchester City", 0.90, 0.82), ("Bayern Munich", 0.92, 0.78),
        ("PSG", 0.92, 0.80), ("Inter", 0.86, 0.84), ("Liverpool", 0.88, 0.80),
        ("Barcelona", 0.88, 0.74), ("Arsenal", 0.84, 0.86), ("Bayer Leverkusen", 0.84, 0.76),
        ("Atletico Madrid", 0.76, 0.84), ("Borussia Dortmund", 0.78, 0.64), ("Juventus", 0.72, 0.82),
        ("Milan", 0.78, 0.68), ("Atalanta", 0.82, 0.70), ("Benfica", 0.68, 0.62),
        ("Porto", 0.66, 0.64), ("Ajax", 0.64, 0.56), ("Celtic", 0.60, 0.50),
    ],
}

DERBIES = {
    frozenset({"Inter", "Milan"}), frozenset({"Roma", "Lazio"}), frozenset({"Juventus", "Torino"}),
    frozenset({"Manchester City", "Manchester United"}), frozenset({"Liverpool", "Everton"}),
    frozenset({"Arsenal", "Tottenham"}), frozenset({"Real Madrid", "Barcelona"}),
    frozenset({"Real Madrid", "Atletico Madrid"}), frozenset({"Sevilla", "Real Betis"}),
    frozenset({"Bayern Munich", "Borussia Dortmund"}), frozenset({"PSG", "Marseille"}),
}

BOOKMAKERS = ["Bet365", "Pinnacle", "William Hill", "Unibet", "Betfair", "888sport", "Snai", "Sisal"]

REFEREES = [
    ("Daniele Orsato", 4.2, 0.18, 24.1, 0.34, 0.46),
    ("Michael Oliver", 3.6, 0.12, 21.5, 0.28, 0.44),
    ("Felix Zwayer", 4.0, 0.15, 23.0, 0.30, 0.45),
    ("Clement Turpin", 4.4, 0.20, 25.3, 0.33, 0.43),
    ("Antonio Mateu Lahoz", 5.4, 0.25, 27.8, 0.38, 0.42),
    ("Szymon Marciniak", 3.8, 0.14, 22.6, 0.29, 0.47),
    ("Marco Guida", 4.1, 0.16, 23.8, 0.31, 0.45),
    ("Anthony Taylor", 4.3, 0.17, 22.2, 0.32, 0.44),
]

FIRST_NAMES = ["Luca", "Marco", "James", "David", "Karim", "Pedro", "Nico", "Jan", "Leo",
               "Diego", "Andre", "Bruno", "Sergio", "Pablo", "Tom", "Alex", "Ivan", "Emil",
               "Theo", "Rafa", "Milan", "Denis", "Victor", "Hugo", "Adam", "Omar"]
LAST_NAMES = ["Rossi", "Bianchi", "Silva", "Costa", "Muller", "Schmidt", "Garcia", "Lopez",
              "Martin", "Bernard", "Smith", "Johnson", "Brown", "Novak", "Kovac", "Petrov",
              "Moretti", "Greco", "Ferrari", "Ricci", "Dubois", "Laurent", "Weber", "Keller"]

POSITIONS = ["GK", "RB", "CB", "CB", "LB", "CDM", "CM", "CAM", "RW", "ST", "LW"]

DATA_SOURCES = [
    "OddsLab Demo Feed (deterministic)",
    "Cross-validated: internal xG model",
]


def _seed(*parts: object) -> int:
    raw = ":".join(str(p) for p in parts)
    return int(hashlib.sha256(raw.encode()).hexdigest()[:12], 16)


def _rng(*parts: object) -> random.Random:
    return random.Random(_seed(*parts))


def _slug(name: str) -> str:
    return name.lower().replace(" ", "-").replace(".", "")


class DemoProvider(DataProvider):
    name = "demo"

    # ------------------------------------------------------------------
    # Universe
    # ------------------------------------------------------------------
    def leagues(self, sport: str = "football") -> list[League]:
        if sport != "football":
            return []
        return LEAGUES

    def _teams(self, league_id: str) -> list[Team]:
        return [
            Team(id=f"{league_id}:{_slug(n)}", name=n, league_id=league_id, attack=a, defense=d)
            for n, a, d in TEAMS[league_id]
        ]

    # ------------------------------------------------------------------
    # Fixtures
    # ------------------------------------------------------------------
    def fixtures(self, league_id: str | None = None, date: str | None = None) -> list[Fixture]:
        leagues = [league_id] if league_id else [lg.id for lg in LEAGUES]
        if date:
            days = [date]
        else:
            today = datetime.now(timezone.utc).date()
            days = [(today + timedelta(days=i)).isoformat() for i in range(7)]

        out: list[Fixture] = []
        for lg in leagues:
            for day in days:
                out.extend(self._fixtures_for(lg, day))
        out.sort(key=lambda f: f.kickoff_utc)
        return out

    def _fixtures_for(self, league_id: str, date: str) -> list[Fixture]:
        rng = _rng("fixtures", league_id, date)
        teams = self._teams(league_id)
        rng.shuffle(teams)
        # play matches only on some days per league (like a real calendar)
        weekday = datetime.fromisoformat(date).weekday()
        matchdays = {
            "serie-a": {5, 6, 0}, "premier-league": {5, 6}, "la-liga": {4, 5, 6},
            "bundesliga": {4, 5}, "ligue-1": {5, 6}, "champions-league": {1, 2},
        }[league_id]
        if weekday not in matchdays:
            return []
        n_matches = min(len(teams) // 2, rng.randint(3, 6))
        kickoffs = ["12:30", "15:00", "18:00", "20:45"]
        fixtures = []
        league_name = next(lg.name for lg in LEAGUES if lg.id == league_id)
        for i in range(n_matches):
            home, away = teams[2 * i], teams[2 * i + 1]
            ko = rng.choice(kickoffs)
            pair = frozenset({home.name, away.name})
            importance = "derby" if pair in DERBIES else rng.choices(
                ["regular", "title race", "relegation battle", "european qualification"],
                weights=[62, 14, 12, 12],
            )[0]
            if league_id == "champions-league":
                importance = rng.choice(["group decider", "knockout", "regular"])
            fixtures.append(
                Fixture(
                    id=f"{league_id}|{date}|{_slug(home.name)}|{_slug(away.name)}",
                    league_id=league_id,
                    league_name=league_name,
                    home_team=home,
                    away_team=away,
                    kickoff_utc=f"{date}T{ko}:00Z",
                    venue=f"{home.name} Stadium",
                    round=f"Matchday {rng.randint(20, 34)}",
                    importance=importance,
                )
            )
        return fixtures

    def fixture(self, fixture_id: str) -> Fixture:
        league_id, date, _home, _away = fixture_id.split("|")
        for fx in self._fixtures_for(league_id, date):
            if fx.id == fixture_id:
                return fx
        raise KeyError(f"fixture not found: {fixture_id}")

    # ------------------------------------------------------------------
    # Baseline expected goals for a fixture (the latent "truth")
    # ------------------------------------------------------------------
    def base_lambdas(self, fixture: Fixture) -> tuple[float, float]:
        h, a = fixture.home_team, fixture.away_team
        rng = _rng("lambda", fixture.id)
        home_adv = 0.28 + rng.uniform(-0.05, 0.08)
        lam_h = max(0.25, 1.42 * (0.55 + h.attack) * (1.45 - a.defense) + home_adv * 0.55)
        lam_a = max(0.20, 1.42 * (0.55 + a.attack) * (1.45 - h.defense) - home_adv * 0.35)
        lam_h *= rng.uniform(0.94, 1.06)
        lam_a *= rng.uniform(0.94, 1.06)
        return round(lam_h, 3), round(lam_a, 3)

    # ------------------------------------------------------------------
    # Form
    # ------------------------------------------------------------------
    def team_form(self, fixture: Fixture, home: bool) -> TeamForm:
        team = fixture.home_team if home else fixture.away_team
        rng = _rng("form", team.id, fixture.id)
        strength = (team.attack + team.defense) / 2

        def window(n: int) -> FormWindow:
            results = []
            gf = ga = 0
            xg_f = xg_a = 0.0
            for _ in range(n):
                opp = rng.uniform(0.30, 0.90)
                diff = strength - opp + rng.gauss(0, 0.22)
                my_goals = max(0, round(rng.gauss(1.35 + diff * 1.8, 0.9)))
                op_goals = max(0, round(rng.gauss(1.35 - diff * 1.8, 0.9)))
                gf += my_goals
                ga += op_goals
                xg_f += max(0.1, rng.gauss(my_goals * 0.9 + 0.35, 0.35))
                xg_a += max(0.1, rng.gauss(op_goals * 0.9 + 0.35, 0.35))
                results.append("W" if my_goals > op_goals else "D" if my_goals == op_goals else "L")
            wins = results.count("W")
            draws = results.count("D")
            losses = results.count("L")
            return FormWindow(
                matches=n, wins=wins, draws=draws, losses=losses,
                goals_for=gf, goals_against=ga,
                xg_for=round(xg_f, 2), xg_against=round(xg_a, 2),
                shots=round(rng.uniform(9, 19) * (0.7 + strength * 0.7), 1),
                shots_on_target=round(rng.uniform(3.2, 7.5) * (0.7 + strength * 0.7), 1),
                big_chances_created=round(rng.uniform(1.2, 3.4) * (0.6 + strength), 1),
                big_chances_conceded=round(rng.uniform(1.0, 3.0) * (1.5 - strength), 1),
                possession_pct=round(38 + strength * 30 + rng.uniform(-4, 4), 1),
                pass_accuracy_pct=round(74 + strength * 16 + rng.uniform(-2, 2), 1),
                ppda=round(14.5 - strength * 6 + rng.uniform(-1.2, 1.2), 1),
                recoveries=round(38 + rng.uniform(-6, 8), 1),
                corners_for=round(3.5 + strength * 3.4 + rng.uniform(-0.6, 0.6), 1),
                corners_against=round(6.4 - strength * 3.0 + rng.uniform(-0.6, 0.6), 1),
                yellow_cards=round(rng.uniform(1.3, 2.8), 1),
                red_cards=round(rng.uniform(0.02, 0.14), 2),
                points_per_game=round((wins * 3 + draws) / n, 2),
                form_string="".join(results[: min(n, 10)]),
            )

        return TeamForm(team_id=team.id, last5=window(5), last10=window(10), last20=window(20))

    # ------------------------------------------------------------------
    # Squad
    # ------------------------------------------------------------------
    def _player(self, rng: random.Random, position: str, status: str, quality: float) -> PlayerReport:
        name = f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}"
        attacking = position in {"ST", "RW", "LW", "CAM"}
        return PlayerReport(
            name=name, position=position, status=status,
            goals=rng.randint(4, 18) if attacking else rng.randint(0, 5),
            assists=rng.randint(1, 10),
            xg=round(rng.uniform(3, 15) * quality, 1) if attacking else round(rng.uniform(0, 4), 1),
            xa=round(rng.uniform(1, 8) * quality, 1),
            pass_accuracy_pct=round(72 + quality * 20 + rng.uniform(-3, 3), 1),
            shot_accuracy_pct=round(30 + quality * 30 + rng.uniform(-5, 5), 1),
            tackles_won_pct=round(50 + quality * 25 + rng.uniform(-6, 6), 1),
            dribbles_success_pct=round(45 + quality * 30 + rng.uniform(-8, 8), 1),
            fouls_per_game=round(rng.uniform(0.4, 2.1), 1),
            cards=rng.randint(0, 9),
            avg_rating=round(6.2 + quality * 1.4 + rng.uniform(-0.25, 0.25), 2),
            recent_minutes_pct=round(rng.uniform(55, 100), 0),
            fitness=round(rng.uniform(0.75, 1.0), 2),
            importance=round(rng.uniform(0.35, 0.95) * quality + 0.1, 2),
        )

    def squad_report(self, fixture: Fixture, home: bool) -> SquadReport:
        team = fixture.home_team if home else fixture.away_team
        rng = _rng("squad", team.id, fixture.id)
        quality = (team.attack + team.defense) / 2

        n_injured = rng.choices([0, 1, 2, 3], weights=[30, 38, 22, 10])[0]
        n_susp = rng.choices([0, 1], weights=[82, 18])[0]
        n_doubt = rng.choices([0, 1, 2], weights=[50, 35, 15])[0]
        n_yellow_risk = rng.randint(0, 3)
        n_late = rng.choices([0, 1], weights=[70, 30])[0]

        def mk(n: int, status: str) -> list[PlayerReport]:
            return [self._player(rng, rng.choice(POSITIONS), status, quality) for _ in range(n)]

        injured = mk(n_injured, "injured")
        suspended = mk(n_susp, "suspended")
        doubtful = mk(n_doubt, "doubtful")
        yc_risk = mk(n_yellow_risk, "yellow-card risk")
        late = mk(n_late, "returned to training")
        key = sorted(mk(5, "available"), key=lambda p: p.importance, reverse=True)

        lineup = [self._player(rng, pos, "available", quality).name for pos in POSITIONS]
        missing_weight = sum(p.importance for p in injured + suspended) + 0.5 * sum(
            p.importance for p in doubtful
        )
        availability = max(0.55, 1.0 - missing_weight * 0.10)
        euro = fixture.league_id != "champions-league" and rng.random() < 0.22
        rest = rng.choice([2, 3, 3, 4, 5, 6, 7, 7])
        fatigue = min(1.0, max(0.0, (5 - rest) * 0.12 + (0.18 if euro else 0.0) + rng.uniform(0, 0.1)))

        formations = ["4-3-3", "4-2-3-1", "3-5-2", "4-4-2", "3-4-2-1"]
        return SquadReport(
            team_id=team.id,
            injured=injured, suspended=suspended, doubtful=doubtful,
            yellow_card_risk=yc_risk, late_returns=late, key_players=key,
            probable_lineup=lineup,
            formation=rng.choice(formations),
            official_lineup_available=False,
            rotation_risk=round(rng.uniform(0, 0.45) + (0.2 if euro else 0), 2),
            rest_days=rest,
            european_fixture_within_4_days=euro,
            fatigue_index=round(fatigue, 2),
            availability_index=round(availability, 2),
        )

    # ------------------------------------------------------------------
    # Tactics
    # ------------------------------------------------------------------
    def tactical_profile(self, fixture: Fixture, home: bool) -> TacticalProfile:
        team = fixture.home_team if home else fixture.away_team
        rng = _rng("tactics", team.id)
        styles = ["possession", "high-press", "counter-attack", "low-block", "direct"]
        weights = (
            [40, 30, 12, 8, 10] if team.attack > 0.7 else
            [15, 20, 30, 22, 13] if team.attack < 0.45 else [25, 25, 22, 15, 13]
        )
        style = rng.choices(styles, weights=weights)[0]
        strengths_pool = {
            "possession": ["Territorial control in the final third", "Chance creation through central overloads"],
            "high-press": ["Ball recoveries in high zones", "Forcing opposition build-up errors"],
            "counter-attack": ["Lethal transitions with pace up front", "Compact mid-block hard to break"],
            "low-block": ["Defensive solidity inside the box", "Set-piece organization"],
            "direct": ["Aerial dominance on long balls", "Second-ball recovery structure"],
        }
        weaknesses_pool = {
            "possession": ["Exposed to fast transitions behind the defensive line"],
            "high-press": ["Space in behind when press is broken", "High cards count from aggressive duels"],
            "counter-attack": ["Struggles when forced to lead the game"],
            "low-block": ["Limited chance creation from open play"],
            "direct": ["Low pass accuracy under structured pressing"],
        }
        return TacticalProfile(
            team_id=team.id,
            formation=rng.choice(["4-3-3", "4-2-3-1", "3-5-2", "4-4-2", "3-4-2-1"]),
            style=style,
            pressing_intensity=round(rng.uniform(0.3, 0.95) if style == "high-press" else rng.uniform(0.2, 0.7), 2),
            defensive_line_height=round(rng.uniform(0.6, 0.9) if style in {"possession", "high-press"} else rng.uniform(0.2, 0.55), 2),
            counter_attack_threat=round(rng.uniform(0.6, 0.95) if style == "counter-attack" else rng.uniform(0.25, 0.6), 2),
            crossing_volume=round(rng.uniform(0.2, 0.9), 2),
            set_piece_threat=round(rng.uniform(0.25, 0.85), 2),
            strengths=strengths_pool[style],
            weaknesses=weaknesses_pool[style],
        )

    # ------------------------------------------------------------------
    # Head to head
    # ------------------------------------------------------------------
    def head_to_head(self, fixture: Fixture) -> HeadToHead:
        rng = _rng("h2h", fixture.home_team.name, fixture.away_team.name)
        edge = (fixture.home_team.attack + fixture.home_team.defense) - (
            fixture.away_team.attack + fixture.away_team.defense
        )

        results: list[str] = []

        def window(n: int) -> HeadToHeadWindow:
            hw = d = aw = goals = over = btts = 0
            for _ in range(n):
                r = rng.random() + edge * 0.35
                gh = max(0, round(rng.gauss(1.4 + edge, 1.0)))
                ga = max(0, round(rng.gauss(1.3 - edge, 1.0)))
                if r > 0.62:
                    hw += 1
                    gh = max(gh, ga + 1)
                elif r < 0.34:
                    aw += 1
                    ga = max(ga, gh + 1)
                else:
                    d += 1
                    ga = gh
                goals += gh + ga
                over += 1 if gh + ga > 2.5 else 0
                btts += 1 if gh > 0 and ga > 0 else 0
                if len(results) < 10:
                    results.append(f"{gh}-{ga}")
            return HeadToHeadWindow(
                matches=n, home_team_wins=hw, draws=d, away_team_wins=aw,
                avg_goals=round(goals / n, 2),
                over25_pct=round(over / n * 100, 1),
                under25_pct=round((n - over) / n * 100, 1),
                btts_pct=round(btts / n * 100, 1),
            )

        return HeadToHead(last5=window(5), last10=window(10), last20=window(20), recent_results=results[:10])

    # ------------------------------------------------------------------
    # Venue split
    # ------------------------------------------------------------------
    def venue_split(self, fixture: Fixture, home: bool) -> VenueSplit:
        team = fixture.home_team if home else fixture.away_team
        rng = _rng("venue", team.id)
        s = (team.attack + team.defense) / 2
        home_ppg = round(min(3.0, 0.9 + s * 1.9 + rng.uniform(-0.15, 0.25)), 2)
        away_ppg = round(max(0.2, home_ppg - rng.uniform(0.25, 0.85)), 2)
        return VenueSplit(
            team_id=team.id,
            home_ppg=home_ppg, away_ppg=away_ppg,
            home_goals_for_avg=round(0.9 + s * 1.5 + rng.uniform(-0.1, 0.3), 2),
            home_goals_against_avg=round(1.8 - s * 1.1 + rng.uniform(-0.1, 0.2), 2),
            away_goals_for_avg=round(0.7 + s * 1.3 + rng.uniform(-0.15, 0.2), 2),
            away_goals_against_avg=round(2.1 - s * 1.1 + rng.uniform(-0.1, 0.25), 2),
            home_advantage_index=round((home_ppg - away_ppg) / max(home_ppg, 0.1), 2),
        )

    # ------------------------------------------------------------------
    # Motivation
    # ------------------------------------------------------------------
    def motivation(self, fixture: Fixture) -> MotivationReport:
        rng = _rng("motivation", fixture.id)
        is_derby = fixture.importance == "derby"
        contexts = {
            "derby": ("Local derby — pride and bragging rights at stake", 0.92),
            "title race": ("Directly fighting for the title", 0.9),
            "relegation battle": ("Every point vital for survival", 0.88),
            "european qualification": ("Chasing a European spot", 0.78),
            "group decider": ("Qualification decided in this match", 0.9),
            "knockout": ("Knockout tie — no second chances", 0.95),
            "regular": ("Mid-table match with limited stakes", 0.55),
        }
        base_ctx, base = contexts.get(fixture.importance, contexts["regular"])
        hm = min(1.0, base + rng.uniform(-0.08, 0.08))
        am = min(1.0, base + rng.uniform(-0.12, 0.08))
        return MotivationReport(
            home_motivation=round(hm, 2), away_motivation=round(am, 2),
            home_context=base_ctx, away_context=base_ctx,
            is_derby=is_derby, stakes=fixture.importance,
        )

    # ------------------------------------------------------------------
    # External factors
    # ------------------------------------------------------------------
    def external_factors(self, fixture: Fixture) -> ExternalFactors:
        rng = _rng("external", fixture.id)
        condition = rng.choices(["clear", "cloudy", "rain", "heavy rain", "wind", "snow"],
                                weights=[38, 25, 18, 8, 8, 3])[0]
        rain = {"clear": 0.0, "cloudy": 0.0, "rain": rng.uniform(1, 5),
                "heavy rain": rng.uniform(6, 15), "wind": 0.0, "snow": 0.0}[condition]
        ref = rng.choice(REFEREES)
        capacity = rng.randint(18000, 81000)
        att_pct = rng.uniform(0.62, 0.99)
        return ExternalFactors(
            weather=WeatherReport(
                condition=condition,
                temperature_c=round(rng.uniform(-2, 28), 1),
                rain_mm=round(rain, 1),
                snow=condition == "snow",
                wind_kmh=round(rng.uniform(2, 38) if condition == "wind" else rng.uniform(2, 16), 1),
                humidity_pct=round(rng.uniform(35, 92), 0),
                pitch_condition=rng.choices(["excellent", "good", "heavy", "poor"],
                                            weights=[45, 35, 15, 5])[0],
            ),
            referee=RefereeProfile(
                name=ref[0], matches_officiated=rng.randint(120, 420),
                avg_yellow_cards=ref[1], avg_red_cards=ref[2], avg_fouls=ref[3],
                penalties_per_match=ref[4], home_win_pct_officiated=round(ref[5] * 100, 1),
            ),
            var_active=True,
            home_travel_km=0.0,
            away_travel_km=round(rng.uniform(80, 1400), 0),
            timezone_shift_hours=0,
            expected_attendance=int(capacity * att_pct),
            stadium_capacity_pct=round(att_pct * 100, 1),
            crowd_factor=round(att_pct * rng.uniform(0.75, 1.0), 2),
        )

    # ------------------------------------------------------------------
    # Advanced stats
    # ------------------------------------------------------------------
    def advanced_stats(self, fixture: Fixture, home: bool) -> AdvancedStats:
        team = fixture.home_team if home else fixture.away_team
        rng = _rng("advanced", team.id, fixture.id)
        s = (team.attack + team.defense) / 2
        return AdvancedStats(
            team_id=team.id,
            xg_per_game=round(0.75 + team.attack * 1.35 + rng.uniform(-0.1, 0.1), 2),
            xa_per_game=round(0.55 + team.attack * 1.0 + rng.uniform(-0.08, 0.08), 2),
            ppda=round(14.5 - s * 6 + rng.uniform(-1, 1), 1),
            possession_value_per_game=round(1.1 + s * 1.6 + rng.uniform(-0.15, 0.15), 2),
            deep_completions_per_game=round(4 + team.attack * 8 + rng.uniform(-0.8, 0.8), 1),
            passes_into_final_third=round(28 + s * 34 + rng.uniform(-3, 3), 1),
            big_chances_per_game=round(1.0 + team.attack * 2.4 + rng.uniform(-0.2, 0.2), 1),
            big_chances_conceded_per_game=round(3.2 - team.defense * 2.2 + rng.uniform(-0.2, 0.2), 1),
            cross_accuracy_pct=round(20 + s * 16 + rng.uniform(-3, 3), 1),
            set_piece_goals_share_pct=round(rng.uniform(15, 34), 1),
            dangerous_attacks_per_game=round(34 + s * 32 + rng.uniform(-4, 4), 1),
            shot_zones={
                "six_yard_box": round(rng.uniform(6, 12), 1),
                "penalty_area": round(rng.uniform(48, 62), 1),
                "outside_box": round(rng.uniform(28, 44), 1),
            },
            pressure_zones={
                "defensive_third": round(rng.uniform(20, 40), 1),
                "middle_third": round(rng.uniform(35, 50), 1),
                "attacking_third": round(10 + s * 30 + rng.uniform(-4, 4), 1),
            },
        )

    # ------------------------------------------------------------------
    # Odds board
    # ------------------------------------------------------------------
    def odds_board(self, fixture: Fixture) -> OddsBoard:
        lam_h, lam_a = self.base_lambdas(fixture)
        rng = _rng("odds", fixture.id)
        # bookmakers price off a slightly biased view of the true lambdas
        m = pr.score_matrix(lam_h * rng.uniform(0.93, 1.07), lam_a * rng.uniform(0.93, 1.07))
        p_home, p_draw, p_away = pr.outcome_probs(m)

        def selections() -> list[tuple[str, str, str, float]]:
            sel: list[tuple[str, str, str, float]] = [
                ("1X2:HOME", "Match Result (1X2)", f"{fixture.home_team.name} win", p_home),
                ("1X2:DRAW", "Match Result (1X2)", "Draw", p_draw),
                ("1X2:AWAY", "Match Result (1X2)", f"{fixture.away_team.name} win", p_away),
                ("DC:1X", "Double Chance", f"{fixture.home_team.name} or Draw", p_home + p_draw),
                ("DC:X2", "Double Chance", f"Draw or {fixture.away_team.name}", p_draw + p_away),
                ("DC:12", "Double Chance", f"{fixture.home_team.name} or {fixture.away_team.name}", p_home + p_away),
                ("DNB:HOME", "Draw No Bet", f"{fixture.home_team.name} (DNB)", pr.draw_no_bet_prob(m, True)),
                ("DNB:AWAY", "Draw No Bet", f"{fixture.away_team.name} (DNB)", pr.draw_no_bet_prob(m, False)),
                ("BTTS:YES", "Both Teams To Score", "BTTS — Yes", pr.btts_prob(m)),
                ("BTTS:NO", "Both Teams To Score", "BTTS — No", 1 - pr.btts_prob(m)),
            ]
            for line in (0.5, 1.5, 2.5, 3.5, 4.5):
                po = pr.over_prob(m, line)
                sel.append((f"OU:{line}:OVER", "Total Goals", f"Over {line} goals", po))
                sel.append((f"OU:{line}:UNDER", "Total Goals", f"Under {line} goals", 1 - po))
            for hc in (-1.5, 1.5):
                sel.append((f"AH:HOME:{hc}", "Asian Handicap",
                            f"{fixture.home_team.name} {'+' if hc > 0 else ''}{hc}",
                            pr.handicap_cover_prob(m, hc, True)))
                sel.append((f"AH:AWAY:{hc}", "Asian Handicap",
                            f"{fixture.away_team.name} {'+' if hc > 0 else ''}{hc}",
                            pr.handicap_cover_prob(m, hc, False)))
            for line in (0.5, 1.5):
                sel.append((f"TT:HOME:{line}:OVER", "Team Totals",
                            f"{fixture.home_team.name} over {line} goals",
                            pr.team_over_prob(m, line, True)))
                sel.append((f"TT:AWAY:{line}:OVER", "Team Totals",
                            f"{fixture.away_team.name} over {line} goals",
                            pr.team_over_prob(m, line, False)))
            # corners & cards priced from simple normal assumptions
            corners_mu = 9.6 + (lam_h + lam_a - 2.7) * 1.1
            cards_mu = 4.1
            from math import erf, sqrt

            def norm_over(mu: float, sd: float, line: float) -> float:
                return 0.5 * (1 - erf((line - mu) / (sd * sqrt(2))))

            sel.append(("CORN:9.5:OVER", "Corners", "Over 9.5 corners", norm_over(corners_mu, 3.1, 9.5)))
            sel.append(("CORN:9.5:UNDER", "Corners", "Under 9.5 corners", 1 - norm_over(corners_mu, 3.1, 9.5)))
            sel.append(("CARD:4.5:OVER", "Cards", "Over 4.5 cards", norm_over(cards_mu, 2.0, 4.5)))
            sel.append(("CARD:4.5:UNDER", "Cards", "Under 4.5 cards", 1 - norm_over(cards_mu, 2.0, 4.5)))
            return sel

        markets: list[MarketOdds] = []
        history: list[OddsTick] = []
        now = datetime.now(timezone.utc)
        for market_id, group, label, p in selections():
            p = min(max(p, 0.02), 0.985)
            margin = rng.uniform(1.04, 1.08)  # bookmaker overround share
            fair = 1.0 / p
            books = []
            for bk in BOOKMAKERS:
                noise = rng.uniform(0.965, 1.045)
                odds = max(1.01, round(fair / margin * noise, 2))
                books.append(BookmakerOdds(bookmaker=bk, odds=odds))
            best = max(books, key=lambda b: b.odds)
            avg = round(sum(b.odds for b in books) / len(books), 2)
            opening = round(best.odds * rng.uniform(0.9, 1.12), 2)
            movement = round((best.odds - opening) / opening * 100, 1)
            markets.append(
                MarketOdds(
                    market_id=market_id, market_group=group, selection=label,
                    best_odds=best.odds, best_bookmaker=best.bookmaker,
                    avg_odds=avg, books=books,
                    opening_odds=opening, movement_pct=movement,
                    suspicious_move=abs(movement) > 9.5,
                )
            )
            # 24h odds movement history for the main markets
            if market_id in {"1X2:HOME", "1X2:DRAW", "1X2:AWAY", "OU:2.5:OVER", "BTTS:YES"}:
                cur = opening
                for hrs in range(24, -1, -3):
                    cur += (best.odds - cur) * rng.uniform(0.2, 0.5) + rng.gauss(0, 0.015)
                    history.append(
                        OddsTick(
                            ts=(now - timedelta(hours=hrs)).isoformat(timespec="minutes"),
                            market_id=market_id,
                            odds=round(max(1.01, cur), 2),
                        )
                    )

        return OddsBoard(fixture_id=fixture.id, markets=markets, history=history)
