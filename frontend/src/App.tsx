import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import AnalysisTabs from './components/AnalysisTabs'
import ControlPanel from './components/ControlPanel'
import HistoryPanel from './components/HistoryPanel'
import RecommendationCard from './components/RecommendationCard'
import type { Fixture, HistoryEntry, League, MatchAnalysis, Recommendation } from './types'

type Theme = 'dark' | 'light'

export default function App() {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('oddslab-theme') as Theme) || 'dark',
  )
  const [leagues, setLeagues] = useState<League[]>([])
  const [fixtures, setFixtures] = useState<Fixture[]>([])
  const [leagueId, setLeagueId] = useState('')
  const [date, setDate] = useState('')
  const [fixtureId, setFixtureId] = useState('')
  const [search, setSearch] = useState('')
  const [targetOdds, setTargetOdds] = useState(1.5)
  const [tolerance, setTolerance] = useState(12)
  const [autoRefresh, setAutoRefresh] = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null)
  const [analysis, setAnalysis] = useState<MatchAnalysis | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('oddslab-theme', theme)
  }, [theme])

  useEffect(() => {
    api.leagues().then(setLeagues).catch(() => setError('Backend non raggiungibile: avvia il server su :8000'))
    api.history().then(setHistory).catch(() => {})
  }, [])

  useEffect(() => {
    api.fixtures(leagueId || undefined, date || undefined)
      .then((fx) => {
        setFixtures(fx)
        setFixtureId((cur) => (fx.some((f) => f.id === cur) ? cur : ''))
      })
      .catch(() => setFixtures([]))
  }, [leagueId, date])

  const runRecommendation = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const rec = await api.recommend({
        league_id: leagueId || null,
        fixture_id: fixtureId || null,
        date: date || null,
        target_odds: targetOdds,
        tolerance_pct: tolerance,
      })
      setRecommendation(rec)
      const an = await api.analysis(rec.fixture.id)
      setAnalysis(an)
      setLastUpdate(new Date())
      api.history().then(setHistory).catch(() => {})
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore imprevisto')
    } finally {
      setLoading(false)
    }
  }, [leagueId, fixtureId, date, targetOdds, tolerance])

  // se l'utente seleziona una partita, mostra subito l'analisi completa
  useEffect(() => {
    if (!fixtureId) return
    api.analysis(fixtureId).then((an) => {
      setAnalysis(an)
      setLastUpdate(new Date())
    }).catch(() => {})
  }, [fixtureId])

  // aggiornamento in tempo reale: ricalcolo periodico di quote/probabilità
  useEffect(() => {
    if (!autoRefresh || !analysis) return
    const id = setInterval(async () => {
      try {
        const an = await api.refresh(analysis.fixture.id)
        setAnalysis(an)
        setLastUpdate(new Date())
      } catch { /* riprova al giro successivo */ }
    }, 60_000)
    return () => clearInterval(id)
  }, [autoRefresh, analysis?.fixture.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">
          <span className="logo-mark">⚡</span>
          OddsLab
          <span className="muted" style={{ fontWeight: 500 }}>Sports Betting Intelligence</span>
        </div>
        <div className="spacer" />
        {lastUpdate && (
          <span className="status-pill">
            <span className="status-dot" />
            Aggiornato {lastUpdate.toLocaleTimeString('it-IT')}
          </span>
        )}
        <button
          className="icon-btn"
          title={theme === 'dark' ? 'Tema chiaro' : 'Tema scuro'}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <ControlPanel
            leagues={leagues}
            fixtures={fixtures}
            leagueId={leagueId}
            date={date}
            fixtureId={fixtureId}
            targetOdds={targetOdds}
            tolerance={tolerance}
            search={search}
            loading={loading}
            autoRefresh={autoRefresh}
            onLeague={setLeagueId}
            onDate={setDate}
            onFixture={setFixtureId}
            onOdds={setTargetOdds}
            onTolerance={setTolerance}
            onSearch={setSearch}
            onAutoRefresh={setAutoRefresh}
            onSubmit={runRecommendation}
          />
          <HistoryPanel entries={history} />
        </aside>

        <main className="main-col">
          {error && <div className="error-box">{error}</div>}

          {recommendation && <RecommendationCard rec={recommendation} />}

          {analysis && (
            <>
              <div className="panel panel-pad">
                <div className="match-title">
                  {analysis.fixture.home_team.name} — {analysis.fixture.away_team.name}
                </div>
                <div className="muted">
                  {analysis.fixture.league_name} · {analysis.fixture.round} ·{' '}
                  {new Date(analysis.fixture.kickoff_utc).toLocaleString('it-IT')} · {analysis.fixture.venue}
                  {analysis.fixture.importance !== 'regular' ? ` · ${analysis.fixture.importance}` : ''}
                </div>
                <div className="muted" style={{ marginTop: 6 }}>
                  Fonti dati: {analysis.data_sources.join(' · ')} · Generata: {new Date(analysis.generated_at).toLocaleTimeString('it-IT')}
                </div>
              </div>
              <AnalysisTabs analysis={analysis} />
            </>
          )}

          {!recommendation && !analysis && !error && (
            <div className="panel empty-state">
              <div className="icon">🎯</div>
              <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-2)' }}>
                Inserisci la quota desiderata e avvia l'analisi
              </div>
              <div style={{ maxWidth: 480, margin: '8px auto 0' }}>
                Il sistema analizza tutte le partite e tutti i mercati disponibili — forma, rosa,
                tattica, scontri diretti, motivazioni, meteo, arbitro, quote — e ti propone la giocata
                con la probabilità di successo stimata più alta compatibile con la quota richiesta.
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
