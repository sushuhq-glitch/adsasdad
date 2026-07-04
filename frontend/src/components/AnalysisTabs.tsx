import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { FormWindow, MatchAnalysis, PlayerReport, SquadReport } from '../types'
import { FormString, pct, signed } from './shared'

const TABS = [
  'Forma', 'Rosa', 'Tattica', 'Scontri diretti', 'Contesto',
  'Statistiche avanzate', 'Simulazione', 'Quote',
] as const

type Tab = (typeof TABS)[number]

const tooltipStyle = {
  contentStyle: {
    background: 'var(--panel)', border: '1px solid var(--border)',
    borderRadius: 8, fontSize: 12,
  },
  labelStyle: { color: 'var(--text)' },
}

function FormTable({ label, home, away }: { label: string; home: FormWindow; away: FormWindow }) {
  const rows: [string, string | number, string | number][] = [
    ['V-P-S', `${home.wins}-${home.draws}-${home.losses}`, `${away.wins}-${away.draws}-${away.losses}`],
    ['Punti/partita', home.points_per_game, away.points_per_game],
    ['Gol fatti / subiti', `${home.goals_for} / ${home.goals_against}`, `${away.goals_for} / ${away.goals_against}`],
    ['xG / xGA', `${home.xg_for} / ${home.xg_against}`, `${away.xg_for} / ${away.xg_against}`],
    ['Tiri (in porta)', `${home.shots} (${home.shots_on_target})`, `${away.shots} (${away.shots_on_target})`],
    ['Occasioni create / concesse', `${home.big_chances_created} / ${home.big_chances_conceded}`, `${away.big_chances_created} / ${away.big_chances_conceded}`],
    ['Possesso %', home.possession_pct, away.possession_pct],
    ['Precisione passaggi %', home.pass_accuracy_pct, away.pass_accuracy_pct],
    ['PPDA (pressing)', home.ppda, away.ppda],
    ['Recuperi palla', home.recoveries, away.recoveries],
    ['Corner (a favore / contro)', `${home.corners_for} / ${home.corners_against}`, `${away.corners_for} / ${away.corners_against}`],
    ['Cartellini (G+R)', `${home.yellow_cards} + ${home.red_cards}`, `${away.yellow_cards} + ${away.red_cards}`],
  ]
  return (
    <div>
      <p className="sub-title">{label}</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Statistica</th><th className="num">Casa</th><th className="num">Trasferta</th></tr>
          </thead>
          <tbody>
            {rows.map(([k, h, a]) => (
              <tr key={k}><td>{k}</td><td className="num">{h}</td><td className="num">{a}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PlayerList({ title, players }: { title: string; players: PlayerReport[] }) {
  if (players.length === 0) return null
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="muted" style={{ marginBottom: 4 }}>{title}</div>
      <div className="pill-list">
        {players.map((p) => (
          <span key={p.name + p.position} className="player-pill" title={`Voto medio ${p.avg_rating} · xG ${p.xg} · xA ${p.xa}`}>
            {p.name} ({p.position})
          </span>
        ))}
      </div>
    </div>
  )
}

function SquadBlock({ name, squad }: { name: string; squad: SquadReport }) {
  return (
    <div>
      <p className="sub-title">{name} — modulo {squad.formation}</p>
      <div className="muted" style={{ marginBottom: 8 }}>
        Disponibilità rosa {pct(squad.availability_index, 0)} · Stanchezza {pct(squad.fatigue_index, 0)} ·
        Rischio turnover {pct(squad.rotation_risk, 0)} · Riposo {squad.rest_days} giorni
        {squad.european_fixture_within_4_days ? ' · Impegno europeo ravvicinato' : ''}
        {squad.official_lineup_available ? ' · Formazione ufficiale' : ' · Formazione probabile'}
      </div>
      <PlayerList title="Infortunati" players={squad.injured} />
      <PlayerList title="Squalificati" players={squad.suspended} />
      <PlayerList title="In dubbio" players={squad.doubtful} />
      <PlayerList title="Diffidati / a rischio giallo" players={squad.yellow_card_risk} />
      <PlayerList title="Recuperati dell'ultimo minuto" players={squad.late_returns} />
      <p className="sub-title" style={{ marginTop: 12 }}>Giocatori chiave</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Giocatore</th><th>Ruolo</th><th className="num">Gol</th><th className="num">Assist</th>
              <th className="num">xG</th><th className="num">xA</th><th className="num">Voto</th><th className="num">Forma fisica</th>
            </tr>
          </thead>
          <tbody>
            {squad.key_players.map((p) => (
              <tr key={p.name}>
                <td>{p.name}</td><td className="muted">{p.position}</td>
                <td className="num">{p.goals}</td><td className="num">{p.assists}</td>
                <td className="num">{p.xg}</td><td className="num">{p.xa}</td>
                <td className="num">{p.avg_rating}</td><td className="num">{pct(p.fitness, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function AnalysisTabs({ analysis }: { analysis: MatchAnalysis }) {
  const [tab, setTab] = useState<Tab>('Forma')
  const fx = analysis.fixture
  const sim = analysis.simulation

  const exactData = useMemo(
    () => Object.entries(sim.exact_scores).map(([score, p]) => ({ score, prob: +(p * 100).toFixed(2) })),
    [sim],
  )

  const ouData = useMemo(
    () => Object.entries(sim.over_under).map(([line, p]) => ({
      line: `O${line}`, Over: +(p * 100).toFixed(1), Under: +((1 - p) * 100).toFixed(1),
    })),
    [sim],
  )

  const oddsHistory = useMemo(() => {
    const byTs: Record<string, Record<string, number | string>> = {}
    for (const tick of analysis.odds_board.history) {
      const label = tick.ts.slice(11, 16)
      const key = tick.ts
      byTs[key] = byTs[key] ?? { ts: label }
      byTs[key][tick.market_id] = tick.odds
    }
    return Object.keys(byTs).sort().map((k) => byTs[k])
  }, [analysis])

  return (
    <div className="panel">
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      <div className="tab-body">
        {tab === 'Forma' && (
          <div>
            <div className="duo-grid" style={{ marginBottom: 14 }}>
              <div>
                <p className="sub-title">{fx.home_team.name} — ultime 10</p>
                <FormString value={analysis.home_form.last10.form_string} />
              </div>
              <div>
                <p className="sub-title">{fx.away_team.name} — ultime 10</p>
                <FormString value={analysis.away_form.last10.form_string} />
              </div>
            </div>
            <div className="duo-grid">
              <FormTable label={`${fx.home_team.name} — ultime 5`} home={analysis.home_form.last5} away={analysis.away_form.last5} />
              <FormTable label="Ultime 20 (medie estese)" home={analysis.home_form.last20} away={analysis.away_form.last20} />
            </div>
          </div>
        )}

        {tab === 'Rosa' && (
          <div className="duo-grid">
            <SquadBlock name={fx.home_team.name} squad={analysis.home_squad} />
            <SquadBlock name={fx.away_team.name} squad={analysis.away_squad} />
          </div>
        )}

        {tab === 'Tattica' && (
          <div>
            <div className="reasoning" style={{ marginTop: 0 }}>{analysis.tactical_verdict}</div>
            <div className="duo-grid">
              {[{ t: analysis.home_tactics, n: fx.home_team.name }, { t: analysis.away_tactics, n: fx.away_team.name }].map(({ t, n }) => (
                <div key={n}>
                  <p className="sub-title">{n} — {t.formation} · {t.style}</p>
                  <div className="table-wrap">
                    <table>
                      <tbody>
                        <tr><td>Intensità pressing</td><td className="num">{pct(t.pressing_intensity, 0)}</td></tr>
                        <tr><td>Altezza linea difensiva</td><td className="num">{pct(t.defensive_line_height, 0)}</td></tr>
                        <tr><td>Pericolosità in contropiede</td><td className="num">{pct(t.counter_attack_threat, 0)}</td></tr>
                        <tr><td>Volume di cross</td><td className="num">{pct(t.crossing_volume, 0)}</td></tr>
                        <tr><td>Palle inattive</td><td className="num">{pct(t.set_piece_threat, 0)}</td></tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="muted" style={{ marginTop: 8 }}>
                    <b>Punti forti:</b> {t.strengths.join('; ')}<br />
                    <b>Punti deboli:</b> {t.weaknesses.join('; ')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'Scontri diretti' && (
          <div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Finestra</th><th className="num">Vitt. {fx.home_team.name}</th><th className="num">Pareggi</th>
                    <th className="num">Vitt. {fx.away_team.name}</th><th className="num">Media gol</th>
                    <th className="num">Over 2.5</th><th className="num">Under 2.5</th><th className="num">BTTS</th>
                  </tr>
                </thead>
                <tbody>
                  {[['Ultimi 5', analysis.head_to_head.last5], ['Ultimi 10', analysis.head_to_head.last10], ['Ultimi 20', analysis.head_to_head.last20]].map(([label, w]) => {
                    const win = w as typeof analysis.head_to_head.last5
                    return (
                      <tr key={label as string}>
                        <td>{label as string}</td>
                        <td className="num">{win.home_team_wins}</td>
                        <td className="num">{win.draws}</td>
                        <td className="num">{win.away_team_wins}</td>
                        <td className="num">{win.avg_goals}</td>
                        <td className="num">{win.over25_pct}%</td>
                        <td className="num">{win.under25_pct}%</td>
                        <td className="num">{win.btts_pct}%</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="sub-title" style={{ marginTop: 14 }}>Risultati recenti</p>
            <div className="pill-list">
              {analysis.head_to_head.recent_results.map((r, i) => (
                <span key={i} className="player-pill">{r}</span>
              ))}
            </div>
          </div>
        )}

        {tab === 'Contesto' && (
          <div>
            <div className="duo-grid">
              <div>
                <p className="sub-title">Fattore campo</p>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th></th><th className="num">{fx.home_team.name}</th><th className="num">{fx.away_team.name}</th></tr></thead>
                    <tbody>
                      <tr><td>Punti/partita in casa</td><td className="num">{analysis.home_venue_split.home_ppg}</td><td className="num">{analysis.away_venue_split.home_ppg}</td></tr>
                      <tr><td>Punti/partita in trasferta</td><td className="num">{analysis.home_venue_split.away_ppg}</td><td className="num">{analysis.away_venue_split.away_ppg}</td></tr>
                      <tr><td>Gol fatti in casa (media)</td><td className="num">{analysis.home_venue_split.home_goals_for_avg}</td><td className="num">{analysis.away_venue_split.home_goals_for_avg}</td></tr>
                      <tr><td>Gol subiti in trasferta (media)</td><td className="num">{analysis.home_venue_split.away_goals_against_avg}</td><td className="num">{analysis.away_venue_split.away_goals_against_avg}</td></tr>
                      <tr><td>Indice vantaggio casa</td><td className="num">{analysis.home_venue_split.home_advantage_index}</td><td className="num">{analysis.away_venue_split.home_advantage_index}</td></tr>
                    </tbody>
                  </table>
                </div>
                <p className="sub-title" style={{ marginTop: 14 }}>Motivazioni — {analysis.motivation.stakes}{analysis.motivation.is_derby ? ' · DERBY' : ''}</p>
                <div className="muted">
                  {fx.home_team.name}: {pct(analysis.motivation.home_motivation, 0)} — {analysis.motivation.home_context}<br />
                  {fx.away_team.name}: {pct(analysis.motivation.away_motivation, 0)} — {analysis.motivation.away_context}
                </div>
              </div>
              <div>
                <p className="sub-title">Meteo e stadio</p>
                <div className="table-wrap">
                  <table>
                    <tbody>
                      <tr><td>Condizioni</td><td className="num">{analysis.external.weather.condition}</td></tr>
                      <tr><td>Temperatura</td><td className="num">{analysis.external.weather.temperature_c}°C</td></tr>
                      <tr><td>Pioggia</td><td className="num">{analysis.external.weather.rain_mm} mm</td></tr>
                      <tr><td>Vento</td><td className="num">{analysis.external.weather.wind_kmh} km/h</td></tr>
                      <tr><td>Umidità</td><td className="num">{analysis.external.weather.humidity_pct}%</td></tr>
                      <tr><td>Terreno di gioco</td><td className="num">{analysis.external.weather.pitch_condition}</td></tr>
                      <tr><td>Spettatori attesi</td><td className="num">{analysis.external.expected_attendance.toLocaleString('it-IT')} ({analysis.external.stadium_capacity_pct}%)</td></tr>
                      <tr><td>Viaggio ospiti</td><td className="num">{analysis.external.away_travel_km} km</td></tr>
                    </tbody>
                  </table>
                </div>
                <p className="sub-title" style={{ marginTop: 14 }}>Arbitro: {analysis.external.referee.name}</p>
                <div className="muted">
                  {analysis.external.referee.matches_officiated} partite dirette · {analysis.external.referee.avg_yellow_cards} gialli/gara ·{' '}
                  {analysis.external.referee.avg_red_cards} rossi/gara · {analysis.external.referee.avg_fouls} falli/gara ·{' '}
                  {analysis.external.referee.penalties_per_match} rigori/gara · VAR {analysis.external.var_active ? 'attivo' : 'non attivo'}
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'Statistiche avanzate' && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Metrica</th><th className="num">{fx.home_team.name}</th><th className="num">{fx.away_team.name}</th></tr>
              </thead>
              <tbody>
                <tr><td>xG a partita</td><td className="num">{analysis.home_advanced.xg_per_game}</td><td className="num">{analysis.away_advanced.xg_per_game}</td></tr>
                <tr><td>xA a partita</td><td className="num">{analysis.home_advanced.xa_per_game}</td><td className="num">{analysis.away_advanced.xa_per_game}</td></tr>
                <tr><td>PPDA</td><td className="num">{analysis.home_advanced.ppda}</td><td className="num">{analysis.away_advanced.ppda}</td></tr>
                <tr><td>Possession value</td><td className="num">{analysis.home_advanced.possession_value_per_game}</td><td className="num">{analysis.away_advanced.possession_value_per_game}</td></tr>
                <tr><td>Deep completions</td><td className="num">{analysis.home_advanced.deep_completions_per_game}</td><td className="num">{analysis.away_advanced.deep_completions_per_game}</td></tr>
                <tr><td>Passaggi nell'ultimo terzo</td><td className="num">{analysis.home_advanced.passes_into_final_third}</td><td className="num">{analysis.away_advanced.passes_into_final_third}</td></tr>
                <tr><td>Big chances create</td><td className="num">{analysis.home_advanced.big_chances_per_game}</td><td className="num">{analysis.away_advanced.big_chances_per_game}</td></tr>
                <tr><td>Big chances concesse</td><td className="num">{analysis.home_advanced.big_chances_conceded_per_game}</td><td className="num">{analysis.away_advanced.big_chances_conceded_per_game}</td></tr>
                <tr><td>Precisione cross %</td><td className="num">{analysis.home_advanced.cross_accuracy_pct}</td><td className="num">{analysis.away_advanced.cross_accuracy_pct}</td></tr>
                <tr><td>Quota gol da palla inattiva %</td><td className="num">{analysis.home_advanced.set_piece_goals_share_pct}</td><td className="num">{analysis.away_advanced.set_piece_goals_share_pct}</td></tr>
                <tr><td>Attacchi pericolosi</td><td className="num">{analysis.home_advanced.dangerous_attacks_per_game}</td><td className="num">{analysis.away_advanced.dangerous_attacks_per_game}</td></tr>
                <tr><td>Tiri: area di rigore %</td><td className="num">{analysis.home_advanced.shot_zones.penalty_area}</td><td className="num">{analysis.away_advanced.shot_zones.penalty_area}</td></tr>
                <tr><td>Tiri: fuori area %</td><td className="num">{analysis.home_advanced.shot_zones.outside_box}</td><td className="num">{analysis.away_advanced.shot_zones.outside_box}</td></tr>
                <tr><td>Pressione: terzo offensivo %</td><td className="num">{analysis.home_advanced.pressure_zones.attacking_third}</td><td className="num">{analysis.away_advanced.pressure_zones.attacking_third}</td></tr>
              </tbody>
            </table>
          </div>
        )}

        {tab === 'Simulazione' && (
          <div>
            <div className="metric-grid">
              <div className="metric"><div className="k">1 (Casa)</div><div className="v">{pct(sim.p_home)}</div></div>
              <div className="metric"><div className="k">X (Pareggio)</div><div className="v">{pct(sim.p_draw)}</div></div>
              <div className="metric"><div className="k">2 (Trasferta)</div><div className="v">{pct(sim.p_away)}</div></div>
              <div className="metric"><div className="k">BTTS</div><div className="v">{pct(sim.btts)}</div></div>
              <div className="metric"><div className="k">Corner attesi</div><div className="v">{sim.corners_avg}</div></div>
              <div className="metric"><div className="k">Cartellini attesi</div><div className="v">{sim.cards_avg}</div></div>
            </div>
            <div className="muted" style={{ marginBottom: 12 }}>
              {sim.n_simulations.toLocaleString('it-IT')} partite virtuali simulate · xG attesi: {fx.home_team.name} {sim.lambda_home} — {fx.away_team.name} {sim.lambda_away}
            </div>
            <div className="duo-grid">
              <div>
                <p className="sub-title">Risultati esatti più probabili (%)</p>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={exactData} margin={{ top: 4, right: 8, left: -18, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                    <XAxis dataKey="score" tick={{ fontSize: 11, fill: 'var(--text-3)' }} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--text-3)' }} />
                    <Tooltip {...tooltipStyle} />
                    <Bar dataKey="prob" name="Probabilità %" fill="#34d399" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div>
                <p className="sub-title">Linee Over/Under (%)</p>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={ouData} margin={{ top: 4, right: 8, left: -18, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                    <XAxis dataKey="line" tick={{ fontSize: 11, fill: 'var(--text-3)' }} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--text-3)' }} />
                    <Tooltip {...tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Over" fill="#60a5fa" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Under" fill="#fbbf24" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            {Object.keys(sim.top_scorers).length > 0 && (
              <>
                <p className="sub-title" style={{ marginTop: 14 }}>Probabili marcatori (anytime)</p>
                <div className="pill-list">
                  {Object.entries(sim.top_scorers).map(([name, p]) => (
                    <span key={name} className="player-pill">{name}: {pct(p)}</span>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'Quote' && (
          <div>
            {oddsHistory.length > 0 && (
              <>
                <p className="sub-title">Movimento quote — ultime 24 ore</p>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={oddsHistory} margin={{ top: 4, right: 8, left: -18, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                    <XAxis dataKey="ts" tick={{ fontSize: 11, fill: 'var(--text-3)' }} />
                    <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11, fill: 'var(--text-3)' }} />
                    <Tooltip {...tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="1X2:HOME" name="1 (Casa)" stroke="#34d399" dot={false} strokeWidth={2} connectNulls />
                    <Line type="monotone" dataKey="1X2:DRAW" name="X" stroke="#fbbf24" dot={false} strokeWidth={2} connectNulls />
                    <Line type="monotone" dataKey="1X2:AWAY" name="2 (Trasferta)" stroke="#60a5fa" dot={false} strokeWidth={2} connectNulls />
                    <Line type="monotone" dataKey="OU:2.5:OVER" name="Over 2.5" stroke="#f87171" dot={false} strokeWidth={2} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </>
            )}
            <p className="sub-title" style={{ marginTop: 14 }}>Board completo ({analysis.odds_board.markets.length} mercati · {analysis.evaluations.length} valutati)</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Selezione</th><th>Mercato</th><th className="num">Migliore</th><th>Bookmaker</th>
                    <th className="num">Media</th><th className="num">Apertura</th><th className="num">Movimento</th>
                    <th className="num">Prob. modello</th><th className="num">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.evaluations.map((ev) => {
                    const mk = analysis.odds_board.markets.find((m) => m.market_id === ev.market_id)
                    if (!mk) return null
                    return (
                      <tr key={ev.market_id}>
                        <td>{ev.selection}</td>
                        <td className="muted">{ev.market_group}</td>
                        <td className="num">{mk.best_odds.toFixed(2)}</td>
                        <td className="muted">{mk.best_bookmaker}</td>
                        <td className="num">{mk.avg_odds.toFixed(2)}</td>
                        <td className="num">{mk.opening_odds.toFixed(2)}</td>
                        <td className={`num ${mk.movement_pct >= 0 ? 'pos' : 'neg'}`}>
                          {signed(mk.movement_pct)}{mk.suspicious_move ? ' ⚠' : ''}
                        </td>
                        <td className="num">{pct(ev.probability)}</td>
                        <td className={`num ${ev.value_pct >= 0 ? 'pos' : 'neg'}`}>{signed(ev.value_pct)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
