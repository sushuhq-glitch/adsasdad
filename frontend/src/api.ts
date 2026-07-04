import type {
  Fixture,
  HistoryEntry,
  League,
  MatchAnalysis,
  Recommendation,
} from './types'

const BASE = '/api'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error((await res.json()).detail ?? res.statusText)
  return res.json()
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error((await res.json()).detail ?? res.statusText)
  return res.json()
}

export const api = {
  leagues: () => get<League[]>('/leagues'),
  fixtures: (leagueId?: string, date?: string) => {
    const params = new URLSearchParams()
    if (leagueId) params.set('league_id', leagueId)
    if (date) params.set('date', date)
    const qs = params.toString()
    return get<Fixture[]>(`/fixtures${qs ? `?${qs}` : ''}`)
  },
  analysis: (fixtureId: string) =>
    get<MatchAnalysis>(`/analysis/${encodeURIComponent(fixtureId)}`),
  refresh: (fixtureId: string) =>
    post<MatchAnalysis>(`/refresh/${encodeURIComponent(fixtureId)}`),
  recommend: (req: {
    sport?: string
    league_id?: string | null
    fixture_id?: string | null
    date?: string | null
    target_odds: number
    tolerance_pct?: number
  }) => post<Recommendation>('/recommend', req),
  history: () => get<HistoryEntry[]>('/history'),
}
