"""Motore di raccomandazione.

Dato l'obiettivo di quota dell'utente, analizza tutte le partite candidate e
tutti i mercati disponibili, quindi seleziona la giocata con la probabilità
stimata più alta tra quelle compatibili con la quota richiesta.

Criterio di ordinamento (in ordine):
1. probabilità stimata (obiettivo primario richiesto);
2. margine di valore (EV) come tie-break;
3. confidenza del modello.
"""
from __future__ import annotations

from ..data.aggregator import get_aggregator
from ..schemas import (
    Fixture,
    KeyFactor,
    MarketEvaluation,
    MatchAnalysis,
    Recommendation,
    RecommendRequest,
)
from .analyzer import analysis_extra_factors, analyze_fixture

DISCLAIMER = (
    "Nessuna previsione è certa: le probabilità sono stime statistiche soggette a incertezza "
    "(infortuni dell'ultimo minuto, episodi arbitrali, varianza intrinseca del calcio). "
    "Il modello indica il livello di confidenza e i fattori di rischio proprio per questo. "
    "Gioca responsabilmente e solo somme che puoi permetterti di perdere."
)


def _reliability(ev: MarketEvaluation) -> str:
    score = ev.probability * 0.55 + ev.confidence * 0.30 + max(min(ev.value_pct / 20, 1), -1) * 0.15
    if score >= 0.78:
        return "Molto alta"
    if score >= 0.62:
        return "Alta"
    if score >= 0.45:
        return "Media"
    return "Bassa"


def _market_rationale(analysis: MatchAnalysis, ev: MarketEvaluation) -> str:
    """Motivazione specifica per il tipo di mercato selezionato, con i dati
    che sostengono (o indeboliscono) proprio quella giocata."""
    fx = analysis.fixture
    sim = analysis.simulation
    hf, af = analysis.home_form.last10, analysis.away_form.last10
    kind = ev.market_id.split(":")[0]

    if kind in {"1X2", "DC", "DNB", "AH", "COMBO"}:
        return (
            f"Lettura dell'esito: {fx.home_team.name} viaggia a {hf.points_per_game} punti/partita "
            f"(xG {hf.xg_for:.1f} / xGA {hf.xg_against:.1f} nelle ultime 10), {fx.away_team.name} a "
            f"{af.points_per_game} (xG {af.xg_for:.1f} / xGA {af.xg_against:.1f}). "
            f"La simulazione assegna {sim.p_home:.0%} / {sim.p_draw:.0%} / {sim.p_away:.0%} agli esiti 1/X/2."
        )
    if kind in {"OU", "BTTS", "MG", "ODDEVEN", "HT", "TT", "EXACT", "CS", "WTN"}:
        h2h = analysis.head_to_head.last10
        return (
            f"Lettura dei gol: gol attesi combinati {sim.lambda_home + sim.lambda_away:.2f} "
            f"({sim.lambda_home:.2f} casa, {sim.lambda_away:.2f} trasferta). "
            f"Negli scontri diretti il {h2h.over25_pct:.0f}% delle ultime 10 è finita Over 2.5 e il "
            f"{h2h.btts_pct:.0f}% con entrambe a segno. Probabilità simulate: Over 1.5 "
            f"{sim.over_under.get('1.5', 0):.0%}, Over 2.5 {sim.over_under.get('2.5', 0):.0%}, "
            f"Over 3.5 {sim.over_under.get('3.5', 0):.0%}, Gol {sim.btts:.0%}; "
            f"porta inviolata: casa {sim.clean_sheet_home:.0%}, trasferta {sim.clean_sheet_away:.0%}."
        )
    if kind == "CORN":
        return (
            f"Lettura dei corner: {fx.home_team.name} produce {hf.corners_for} corner a partita e ne "
            f"concede {hf.corners_against}; {fx.away_team.name} rispettivamente {af.corners_for} e "
            f"{af.corners_against}. Totale atteso dalla simulazione: {sim.corners_avg:.1f} corner "
            f"(Over 8.5 {sim.corners_over.get('8.5', 0):.0%}, Over 9.5 {sim.corners_over.get('9.5', 0):.0%}, "
            f"Over 10.5 {sim.corners_over.get('10.5', 0):.0%})."
        )
    if kind == "CARD":
        ref = analysis.external.referee
        derby = " Il contesto da derby alza ulteriormente l'attesa di cartellini." if analysis.motivation.is_derby else ""
        return (
            f"Lettura dei cartellini: le due squadre sommano {hf.yellow_cards + af.yellow_cards:.1f} gialli "
            f"a partita nelle ultime 10; l'arbitro {ref.name} estrae in media {ref.avg_yellow_cards:.1f} gialli "
            f"e fischia {ref.avg_fouls:.0f} falli a gara. Attesa simulata: {sim.cards_avg:.1f} cartellini "
            f"(Over 3.5 {sim.cards_over.get('3.5', 0):.0%}, Over 4.5 {sim.cards_over.get('4.5', 0):.0%}).{derby}"
        )
    return ""


def _build_reasoning(analysis: MatchAnalysis, ev: MarketEvaluation, target: float) -> str:
    fx = analysis.fixture
    sim = analysis.simulation
    lines = [
        f"Richiesta: quota {target:.2f}. Selezione consigliata: “{ev.selection}” a quota {ev.best_odds:.2f} "
        f"({ev.best_bookmaker}), la giocata con la probabilità stimata più alta ({ev.probability:.1%}) "
        f"tra i mercati compatibili con la quota richiesta.",
        f"La quota equa calcolata dal modello è {ev.fair_odds:.2f}: il mercato paga {ev.best_odds:.2f}, "
        f"quindi il margine di valore atteso è {ev.value_pct:+.1f}% "
        f"(edge del {ev.edge_over_market:+.1f}% sulla probabilità implicita depurata dal margine del bookmaker).",
        f"Base quantitativa: {sim.n_simulations:,} partite simulate con xG attesi "
        f"{sim.lambda_home:.2f}–{sim.lambda_away:.2f}; probabilità 1X2 finali "
        f"{sim.p_home:.0%}/{sim.p_draw:.0%}/{sim.p_away:.0%}, Over 2.5 {sim.over_under.get('2.5', 0):.0%}, "
        f"BTTS {sim.btts:.0%}.",
        f"Lettura tattica: {analysis.tactical_verdict}",
    ]
    rationale = _market_rationale(analysis, ev)
    if rationale:
        lines.insert(2, rationale)
    h2h = analysis.head_to_head.last10
    lines.append(
        f"Scontri diretti (ultimi 10): {h2h.home_team_wins} vittorie {fx.home_team.name}, {h2h.draws} pareggi, "
        f"{h2h.away_team_wins} vittorie {fx.away_team.name}; media gol {h2h.avg_goals:.1f}, BTTS {h2h.btts_pct:.0f}%."
    )
    ref = analysis.external.referee
    lines.append(
        f"Contesto: arbitro {ref.name} ({ref.avg_yellow_cards:.1f} gialli/gara), meteo {analysis.external.weather.condition}, "
        f"campo {analysis.external.weather.pitch_condition}, pubblico al {analysis.external.stadium_capacity_pct:.0f}%."
    )
    lines.append(
        f"Confidenza del modello: {ev.confidence:.0%} (accordo tra i modelli dell'ensemble e qualità dei dati). "
        f"Frazione di Kelly suggerita: {ev.kelly_fraction:.1%} del bankroll (cap 25%)."
    )
    return "\n\n".join(lines)


def _candidate_fixtures(req: RecommendRequest) -> list[Fixture]:
    agg = get_aggregator()
    if req.fixture_id:
        return [agg.fixture(req.fixture_id)]
    return agg.fixtures(req.league_id, req.date)


def recommend(req: RecommendRequest) -> Recommendation | None:
    fixtures = _candidate_fixtures(req)
    if not fixtures:
        return None

    lo = req.target_odds * (1 - req.tolerance_pct / 100)
    hi = req.target_odds * (1 + req.tolerance_pct / 100)

    scored: list[tuple[MarketEvaluation, MatchAnalysis]] = []
    for fx in fixtures[:40]:  # limite prudenziale per richiesta
        analysis = analyze_fixture(fx.id)
        label = f"{fx.home_team.name} - {fx.away_team.name}"
        for ev in analysis.evaluations:
            if lo <= ev.best_odds <= hi and ev.confidence >= req.min_confidence:
                if not ev.fixture_label:
                    ev.fixture_label = label
                scored.append((ev, analysis))

    if not scored:
        return None

    scored.sort(key=lambda t: (t[0].probability, t[0].value_pct, t[0].confidence), reverse=True)
    best_ev, best_analysis = scored[0]

    # alternative: migliori selezioni successive, al massimo una per
    # combinazione (partita, gruppo di mercato) per dare varietà reale
    alternatives: list[MarketEvaluation] = []
    seen = {(best_analysis.fixture.id, best_ev.market_group)}
    for ev, an in scored[1:]:
        key = (an.fixture.id, ev.market_group)
        if key in seen:
            continue
        alternatives.append(ev)
        seen.add(key)
        if len(alternatives) >= 5:
            break

    adj = analysis_extra_factors.get(best_analysis.fixture.id)
    favorable: list[KeyFactor] = [f for f in (adj.factors if adj else []) if f.kind == "favorable"][:6]
    risks: list[KeyFactor] = [f for f in (adj.factors if adj else []) if f.kind == "risk"][:6]
    if not risks:
        risks = [KeyFactor(
            kind="risk", title="Varianza intrinseca",
            detail="Anche gli esiti più probabili falliscono con regolarità: nessuna scommessa è sicura.",
            impact=-0.05)]

    return Recommendation(
        fixture=best_analysis.fixture,
        market=best_ev,
        target_odds=req.target_odds,
        reliability=_reliability(best_ev),
        reasoning=_build_reasoning(best_analysis, best_ev, req.target_odds),
        favorable_factors=favorable,
        risk_factors=risks,
        alternatives=alternatives,
        model_breakdown=best_analysis.model_breakdown,
        simulation=best_analysis.simulation,
        disclaimer=DISCLAIMER,
    )
