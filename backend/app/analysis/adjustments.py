"""Converte ogni dimensione analizzata (forma, rosa, tattica, scontri diretti,
fattore campo, motivazioni, meteo, arbitro, pubblico...) in:

1. correzioni moltiplicative dei tassi di gol attesi usati dai modelli;
2. *fattori chiave* leggibili con impatto con segno, che alimentano la
   motivazione trasparente mostrata all'utente.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from ..schemas import (
    ExternalFactors,
    Fixture,
    HeadToHead,
    KeyFactor,
    MotivationReport,
    SquadReport,
    TacticalProfile,
    TeamForm,
    VenueSplit,
)


@dataclass
class AdjustmentResult:
    lambda_home: float
    lambda_away: float
    factors: list[KeyFactor] = field(default_factory=list)
    tactical_verdict: str = ""
    goals_multiplier: float = 1.0  # effetto globale sul ritmo (meteo, campo, posta in palio)
    cards_multiplier: float = 1.0
    corners_multiplier: float = 1.0
    data_quality: float = 1.0  # 0..1 fiducia negli input
    form_edge: float = 0.0
    availability_edge: float = 0.0
    motivation_edge: float = 0.0


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


STYLE_IT = {
    "possession": "possesso palla",
    "high-press": "pressing alto",
    "counter-attack": "contropiede",
    "low-block": "difesa bassa",
    "direct": "gioco diretto",
}


def apply_adjustments(
    fixture: Fixture,
    lam_h: float,
    lam_a: float,
    home_form: TeamForm,
    away_form: TeamForm,
    home_squad: SquadReport,
    away_squad: SquadReport,
    home_tactics: TacticalProfile,
    away_tactics: TacticalProfile,
    h2h: HeadToHead,
    home_venue: VenueSplit,
    away_venue: VenueSplit,
    motivation: MotivationReport,
    external: ExternalFactors,
) -> AdjustmentResult:
    res = AdjustmentResult(lambda_home=lam_h, lambda_away=lam_a)
    factors = res.factors

    def add(kind: str, title: str, detail: str, impact: float) -> None:
        factors.append(KeyFactor(kind=kind, title=title, detail=detail, impact=round(impact, 3)))

    home_name = fixture.home_team.name
    away_name = fixture.away_team.name

    # ------------------------------------------------------------------
    # 1. Momento di forma: media pesata dei punti/partita su 5/10/20 gare + delta xG
    # ------------------------------------------------------------------
    def momentum(form: TeamForm) -> float:
        ppg = 0.5 * form.last5.points_per_game + 0.3 * form.last10.points_per_game + 0.2 * form.last20.points_per_game
        xg_diff5 = (form.last5.xg_for - form.last5.xg_against) / max(form.last5.matches, 1)
        return (ppg - 1.35) / 1.65 * 0.6 + _clamp(xg_diff5 / 1.5, -1, 1) * 0.4

    mom_h, mom_a = momentum(home_form), momentum(away_form)
    res.form_edge = _clamp(mom_h - mom_a, -1.0, 1.0)
    res.lambda_home *= 1 + _clamp(mom_h, -0.5, 0.5) * 0.16
    res.lambda_away *= 1 + _clamp(mom_a, -0.5, 0.5) * 0.16
    if mom_h > 0.25:
        add("favorable", f"{home_name} in grande forma",
            f"Ultime 5: {home_form.last5.form_string} ({home_form.last5.points_per_game} punti/partita, "
            f"xG {home_form.last5.xg_for:.1f} contro xGA {home_form.last5.xg_against:.1f})", mom_h * 0.4)
    elif mom_h < -0.25:
        add("risk", f"{home_name} in difficoltà",
            f"Ultime 5: {home_form.last5.form_string} — solo {home_form.last5.points_per_game} punti/partita", mom_h * 0.4)
    if mom_a > 0.25:
        add("risk", f"{away_name} arriva in fiducia",
            f"Ospiti, ultime 5: {away_form.last5.form_string} ({away_form.last5.points_per_game} punti/partita)", -mom_a * 0.35)
    elif mom_a < -0.25:
        add("favorable", f"{away_name} in crisi di risultati",
            f"Ospiti, ultime 5: {away_form.last5.form_string}, xGA {away_form.last5.xg_against:.1f} in 5 gare", -mom_a * 0.35)

    # ------------------------------------------------------------------
    # 2. Disponibilità rosa, stanchezza, turnover
    # ------------------------------------------------------------------
    avail_edge = 0.0
    for squad, name, is_home in ((home_squad, home_name, True), (away_squad, away_name, False)):
        missing = len(squad.injured) + len(squad.suspended)
        avail_mult = 0.80 + 0.20 * squad.availability_index
        fatigue_mult = 1.0 - squad.fatigue_index * 0.10
        rotation_mult = 1.0 - squad.rotation_risk * 0.06
        total = avail_mult * fatigue_mult * rotation_mult
        avail_edge += (total - 0.95) * (1 if is_home else -1)
        if is_home:
            res.lambda_home *= total
            res.lambda_away *= 2.0 - avail_mult  # una difesa rimaneggiata concede di più
        else:
            res.lambda_away *= total
            res.lambda_home *= 2.0 - avail_mult
        if missing >= 2:
            names = ", ".join(p.name for p in (squad.injured + squad.suspended)[:4])
            add("risk" if is_home else "favorable",
                f"{name} senza {missing} giocatori",
                f"Assenti: {names}. Indice di disponibilità {squad.availability_index:.0%}",
                (-0.25 if is_home else 0.2) * min(missing, 4) / 2)
        if squad.fatigue_index > 0.45:
            add("risk" if is_home else "favorable",
                f"Stanchezza per {name}",
                f"Solo {squad.rest_days} giorni di riposo"
                + (", impegno europeo negli ultimi 4 giorni" if squad.european_fixture_within_4_days else ""),
                -0.15 if is_home else 0.12)
        if squad.rotation_risk > 0.4:
            add("risk" if is_home else "favorable",
                f"Possibile turnover per {name}",
                f"Rischio rotazioni stimato al {squad.rotation_risk:.0%} per il calendario congestionato",
                -0.1 if is_home else 0.08)
        res.data_quality *= 1.0 if squad.official_lineup_available else 0.96
    res.availability_edge = _clamp(avail_edge, -0.5, 0.5)

    # ------------------------------------------------------------------
    # 3. Confronto tattico
    # ------------------------------------------------------------------
    verdict_parts = []
    if home_tactics.style == "possession" and away_tactics.style == "counter-attack":
        res.lambda_away *= 1.07
        verdict_parts.append(
            f"Il possesso palla del {home_name} ({home_tactics.formation}) espone la squadra alle ripartenze del "
            f"{away_name}: le transizioni sono la principale via al gol per gli ospiti.")
        add("risk", "Matchup tattico favorevole al contropiede",
            f"Pericolosità in ripartenza del {away_name}: {away_tactics.counter_attack_threat:.0%}, contro una linea difensiva alta", -0.12)
    if home_tactics.style == "high-press" and away_tactics.pressing_intensity < 0.45:
        res.lambda_home *= 1.08
        verdict_parts.append(
            f"Il pressing del {home_name} (intensità {home_tactics.pressing_intensity:.0%}) dovrebbe forzare errori "
            f"in costruzione a una squadra in difficoltà nell'uscita palla al piede.")
        add("favorable", "Mismatch di pressing",
            f"Il {home_name} pressa con intensità {home_tactics.pressing_intensity:.0%}; la costruzione del {away_name} è vulnerabile", 0.14)
    if away_tactics.style == "low-block":
        res.lambda_home *= 0.93
        res.goals_multiplier *= 0.96
        verdict_parts.append(f"La difesa bassa del {away_name} riduce le occasioni attese su azione per entrambe.")
        add("risk", f"Blocco basso del {away_name}", "Struttura difensiva compatta che abbassa il volume di occasioni", -0.08)
    if home_tactics.set_piece_threat > 0.7:
        res.lambda_home *= 1.04
        add("favorable", f"{home_name} pericoloso su palla inattiva",
            f"Indice di pericolosità sui piazzati {home_tactics.set_piece_threat:.0%}, alto volume di corner", 0.08)
    if not verdict_parts:
        verdict_parts.append(
            f"{home_name} ({home_tactics.formation}, {STYLE_IT[home_tactics.style]}) contro {away_name} "
            f"({away_tactics.formation}, {STYLE_IT[away_tactics.style]}): nessun mismatch stilistico estremo, "
            f"a decidere saranno i valori di base e lo stato di forma.")
    res.tactical_verdict = " ".join(verdict_parts)

    # ------------------------------------------------------------------
    # 4. Scontri diretti
    # ------------------------------------------------------------------
    w10 = h2h.last10
    if w10.home_team_wins >= 6:
        res.lambda_home *= 1.05
        add("favorable", "Dominio negli scontri diretti",
            f"Il {home_name} ha vinto {w10.home_team_wins} degli ultimi 10 confronti", 0.12)
    elif w10.away_team_wins >= 6:
        res.lambda_away *= 1.05
        add("risk", "Precedenti sfavorevoli",
            f"Il {away_name} ha vinto {w10.away_team_wins} degli ultimi 10 confronti", -0.12)
    if w10.over25_pct >= 65:
        res.goals_multiplier *= 1.04
        add("favorable", "Sfida storicamente da Over",
            f"Il {w10.over25_pct:.0f}% degli ultimi 10 confronti è finito Over 2.5 (media gol {w10.avg_goals:.1f})", 0.08)
    elif w10.under25_pct >= 65:
        res.goals_multiplier *= 0.96
        add("risk", "Sfida storicamente bloccata",
            f"Il {w10.under25_pct:.0f}% degli ultimi 10 confronti è finito Under 2.5", -0.08)

    # ------------------------------------------------------------------
    # 5. Fattore campo
    # ------------------------------------------------------------------
    if home_venue.home_advantage_index > 0.35:
        res.lambda_home *= 1.06
        add("favorable", f"{home_name} fortissimo in casa",
            f"{home_venue.home_ppg} punti/partita in casa contro {home_venue.away_ppg} in trasferta "
            f"({home_venue.home_goals_for_avg:.1f} gol segnati a partita in casa)", 0.13)
    if away_venue.away_ppg < 1.0:
        res.lambda_away *= 0.94
        add("favorable", f"{away_name} debole in trasferta",
            f"Solo {away_venue.away_ppg} punti/partita fuori casa, con {away_venue.away_goals_against_avg:.1f} gol subiti a gara", 0.11)
    elif away_venue.away_ppg > 1.8:
        res.lambda_away *= 1.05
        add("risk", f"{away_name} ottimo in trasferta",
            f"{away_venue.away_ppg} punti/partita lontano da casa", -0.1)

    # ------------------------------------------------------------------
    # 6. Motivazioni e posta in palio
    # ------------------------------------------------------------------
    diff = motivation.home_motivation - motivation.away_motivation
    res.motivation_edge = _clamp(diff, -0.5, 0.5)
    res.lambda_home *= 1 + diff * 0.10
    res.lambda_away *= 1 - diff * 0.10
    if motivation.is_derby:
        res.cards_multiplier *= 1.25
        res.goals_multiplier *= 0.98
        add("risk", "Volatilità da derby",
            "I derby mostrano varianza più alta, più cartellini e risultati che deviano dai valori", -0.1)
    if motivation.stakes in {"title race", "relegation battle", "knockout", "group decider"}:
        stakes_it = {
            "title race": "lotta al titolo", "relegation battle": "lotta salvezza",
            "knockout": "gara a eliminazione diretta", "group decider": "spareggio del girone",
        }[motivation.stakes]
        add("favorable", f"Posta in palio alta: {stakes_it}",
            f"Motivazione casa {motivation.home_motivation:.0%} contro trasferta {motivation.away_motivation:.0%}", diff * 0.3)

    # ------------------------------------------------------------------
    # 7. Fattori esterni: meteo, campo, arbitro, pubblico, viaggio
    # ------------------------------------------------------------------
    w = external.weather
    if w.condition in {"heavy rain", "snow"} or w.pitch_condition in {"heavy", "poor"}:
        res.goals_multiplier *= 0.93
        add("risk", "Meteo/terreno sfavorevoli",
            f"Condizioni: {w.condition}, campo {w.pitch_condition}, {w.rain_mm}mm di pioggia — "
            "gioco rallentato e qualità delle conclusioni ridotta", -0.12)
    if w.wind_kmh > 30:
        res.goals_multiplier *= 0.96
        add("risk", "Vento forte", f"Vento a {w.wind_kmh} km/h che disturba lanci e cross", -0.07)
    ref = external.referee
    if ref.avg_yellow_cards > 4.6:
        res.cards_multiplier *= 1.15
        add("risk", "Arbitro severo",
            f"{ref.name}: {ref.avg_yellow_cards:.1f} gialli e {ref.penalties_per_match:.2f} rigori a partita", -0.04)
    if external.crowd_factor > 0.85:
        res.lambda_home *= 1.03
        add("favorable", "Grande pubblico atteso",
            f"Stadio al {external.stadium_capacity_pct:.0f}% della capienza (~{external.expected_attendance:,} spettatori)", 0.06)
    if external.away_travel_km > 1000:
        res.lambda_away *= 0.98
        add("favorable", "Trasferta lunga",
            f"Il {away_name} percorre {external.away_travel_km:.0f} km per questa gara", 0.04)

    # limiti di sicurezza sui tassi
    res.lambda_home = _clamp(res.lambda_home * res.goals_multiplier, 0.15, 4.5)
    res.lambda_away = _clamp(res.lambda_away * res.goals_multiplier, 0.10, 4.0)
    res.factors.sort(key=lambda f: abs(f.impact), reverse=True)
    return res
