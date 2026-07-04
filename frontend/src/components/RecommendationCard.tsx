import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Recommendation } from '../types'
import { pct, ProbBar, ReliabilityBadge, signed } from './shared'

const CONF_LABELS: Record<string, string> = {
  accordo_modelli: 'Accordo tra i modelli',
  qualita_dati: 'Qualità dei dati',
  consenso_bookmaker: 'Consenso bookmaker',
  stabilita_quota: 'Stabilità della quota',
  liquidita_mercato: 'Liquidità del mercato',
}

export default function RecommendationCard({ rec }: { rec: Recommendation }) {
  const m = rec.market
  const modelData = rec.model_breakdown.map((mb) => ({
    name: mb.model.replace('Bayesian ', ''),
    Casa: +(mb.p_home * 100).toFixed(1),
    Pareggio: +(mb.p_draw * 100).toFixed(1),
    Trasferta: +(mb.p_away * 100).toFixed(1),
  }))

  return (
    <div className="panel panel-pad">
      <h3>Giocata consigliata</h3>

      <div className="reco-header">
        <span className="reco-selection">{m.selection}</span>
        <span className="big-odds">@{m.best_odds.toFixed(2)}</span>
        <ReliabilityBadge level={rec.reliability} />
        <span className="badge badge-blue">{m.best_bookmaker}</span>
        {m.value_pct >= 0
          ? <span className="badge badge-green">Value {signed(m.value_pct)}</span>
          : <span className="badge badge-amber">Value {signed(m.value_pct)}</span>}
      </div>

      <div className="muted">
        {rec.fixture.home_team.name} - {rec.fixture.away_team.name} · {rec.fixture.league_name} ·{' '}
        {new Date(rec.fixture.kickoff_utc).toLocaleString('it-IT')} · {rec.fixture.venue}
      </div>

      <div className="metric-grid">
        <div className="metric">
          <div className="k">Probabilità stimata</div>
          <div className="v">{pct(m.probability)}</div>
          <ProbBar value={m.probability} />
        </div>
        <div className="metric">
          <div className="k">Quota equa</div>
          <div className="v">{m.fair_odds.toFixed(2)}</div>
        </div>
        <div className="metric">
          <div className="k">Edge sul mercato</div>
          <div className={`v ${m.edge_over_market >= 0 ? 'pos' : 'neg'}`}>{signed(m.edge_over_market)}</div>
        </div>
        <div className="metric">
          <div className="k">Confidenza modello</div>
          <div className="v">{pct(m.confidence, 0)}</div>
          <ProbBar value={m.confidence} />
        </div>
        <div className="metric">
          <div className="k">Kelly suggerito</div>
          <div className="v">{pct(m.kelly_fraction)}</div>
        </div>
        <div className="metric">
          <div className="k">Simulazioni</div>
          <div className="v">{rec.simulation.n_simulations.toLocaleString('it-IT')}</div>
        </div>
      </div>

      <div className="reasoning">{rec.reasoning}</div>

      {Object.keys(m.confidence_breakdown ?? {}).length > 0 && (
        <>
          <p className="sub-title">Da dove nasce la confidenza ({pct(m.confidence, 0)})</p>
          <div className="conf-grid">
            {Object.entries(m.confidence_breakdown).map(([k, v]) => (
              <div key={k} className="conf-item">
                <div className="conf-label">
                  <span>{CONF_LABELS[k] ?? k}</span>
                  <span className="mono">{pct(v, 0)}</span>
                </div>
                <ProbBar value={v} />
              </div>
            ))}
          </div>
          {m.checks?.length > 0 && (
            <div className="checks">
              {m.checks.map((c, i) => (
                <div key={i} className={`check-line ${c.startsWith('✓') ? 'ok' : c.startsWith('⚠') ? 'warn' : 'bad'}`}>{c}</div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="factors-grid">
        <div>
          <p className="sub-title">Fattori favorevoli</p>
          {rec.favorable_factors.length === 0 && <div className="muted">Nessun fattore dominante.</div>}
          {rec.favorable_factors.map((f, i) => (
            <div key={i} className="factor fav">
              <span className="dot" />
              <div>
                <div className="t">{f.title}</div>
                <div className="d">{f.detail}</div>
              </div>
            </div>
          ))}
        </div>
        <div>
          <p className="sub-title">Fattori di rischio</p>
          {rec.risk_factors.map((f, i) => (
            <div key={i} className="factor risk">
              <span className="dot" />
              <div>
                <div className="t">{f.title}</div>
                <div className="d">{f.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="sub-title" style={{ marginTop: 18 }}>Accordo tra i modelli (probabilità 1X2, %)</p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={modelData} margin={{ top: 4, right: 8, left: -18, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-3)' }} interval={0} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--text-3)' }} />
          <Tooltip
            contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: 'var(--text)' }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="Casa" fill="#34d399" radius={[3, 3, 0, 0]} />
          <Bar dataKey="Pareggio" fill="#fbbf24" radius={[3, 3, 0, 0]} />
          <Bar dataKey="Trasferta" fill="#60a5fa" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>

      {rec.alternatives.length > 0 && (
        <>
          <p className="sub-title" style={{ marginTop: 14 }}>Mercati alternativi a confronto</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Selezione</th>
                  <th>Partita</th>
                  <th>Mercato</th>
                  <th className="num">Quota</th>
                  <th className="num">Probabilità</th>
                  <th className="num">Value</th>
                  <th className="num">Confidenza</th>
                </tr>
              </thead>
              <tbody>
                {rec.alternatives.map((a) => (
                  <tr key={a.market_id + a.selection}>
                    <td>{a.selection}</td>
                    <td className="muted">{a.fixture_label}</td>
                    <td className="muted">{a.market_group}</td>
                    <td className="num">{a.best_odds.toFixed(2)}</td>
                    <td className="num">{pct(a.probability)}</td>
                    <td className={`num ${a.value_pct >= 0 ? 'pos' : 'neg'}`}>{signed(a.value_pct)}</td>
                    <td className="num">{pct(a.confidence, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="disclaimer">{rec.disclaimer}</div>
    </div>
  )
}
