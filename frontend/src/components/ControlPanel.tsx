import type { Fixture, League } from '../types'

const QUICK_ODDS = [1.3, 1.5, 1.8, 2.0, 2.5, 3.5]

interface Props {
  leagues: League[]
  fixtures: Fixture[]
  leagueId: string
  date: string
  fixtureId: string
  targetOdds: number
  tolerance: number
  search: string
  loading: boolean
  autoRefresh: boolean
  onLeague: (id: string) => void
  onDate: (d: string) => void
  onFixture: (id: string) => void
  onOdds: (o: number) => void
  onTolerance: (t: number) => void
  onSearch: (s: string) => void
  onAutoRefresh: (v: boolean) => void
  onSubmit: () => void
}

export default function ControlPanel(p: Props) {
  const filtered = p.fixtures.filter((f) => {
    const q = p.search.toLowerCase()
    return !q || `${f.home_team.name} ${f.away_team.name}`.toLowerCase().includes(q)
  })

  return (
    <div className="panel panel-pad">
      <h3>Parametri di ricerca</h3>

      <div className="field">
        <label>Sport</label>
        <select value="football" disabled>
          <option value="football">Calcio</option>
        </select>
      </div>

      <div className="field">
        <label>Campionato</label>
        <select value={p.leagueId} onChange={(e) => p.onLeague(e.target.value)}>
          <option value="">Tutti i campionati</option>
          {p.leagues.map((lg) => (
            <option key={lg.id} value={lg.id}>
              {lg.name} ({lg.country})
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>Data</label>
        <input type="date" value={p.date} onChange={(e) => p.onDate(e.target.value)} />
      </div>

      <div className="field">
        <label>Cerca partita</label>
        <input
          type="text"
          placeholder="Es. Inter, Milan..."
          value={p.search}
          onChange={(e) => p.onSearch(e.target.value)}
        />
      </div>

      <div className="field">
        <label>Partita ({filtered.length} disponibili)</label>
        <select value={p.fixtureId} onChange={(e) => p.onFixture(e.target.value)}>
          <option value="">Tutte le partite (scansione completa)</option>
          {filtered.map((f) => (
            <option key={f.id} value={f.id}>
              {f.home_team.name} - {f.away_team.name} · {f.kickoff_utc.slice(0, 10)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>Quota desiderata</label>
        <input
          type="number"
          min={1.01}
          max={100}
          step={0.05}
          value={p.targetOdds}
          onChange={(e) => p.onOdds(parseFloat(e.target.value) || 1.5)}
        />
        <div className="odds-chips">
          {QUICK_ODDS.map((o) => (
            <button
              key={o}
              className={`chip ${Math.abs(p.targetOdds - o) < 0.001 ? 'active' : ''}`}
              onClick={() => p.onOdds(o)}
            >
              {o.toFixed(2)}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Tolleranza quota: ±{p.tolerance}%</label>
        <div className="range-row">
          <input
            type="range"
            min={5}
            max={30}
            value={p.tolerance}
            onChange={(e) => p.onTolerance(parseInt(e.target.value))}
          />
        </div>
      </div>

      <div className="field">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={p.autoRefresh}
            onChange={(e) => p.onAutoRefresh(e.target.checked)}
            style={{ width: 'auto' }}
          />
          Aggiornamento automatico (quote, formazioni, meteo)
        </label>
      </div>

      <button className="btn btn-primary" onClick={p.onSubmit} disabled={p.loading}>
        {p.loading ? (<><span className="spin" />Analisi in corso…</>) : 'Trova la giocata migliore'}
      </button>
    </div>
  )
}
