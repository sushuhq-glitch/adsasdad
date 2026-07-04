import type { HistoryEntry } from '../types'
import { pct, signed } from './shared'

export default function HistoryPanel({ entries }: { entries: HistoryEntry[] }) {
  return (
    <div className="panel panel-pad">
      <h3>Storico pronostici</h3>
      {entries.length === 0 && <div className="muted">Nessun pronostico ancora generato.</div>}
      {entries.slice(0, 8).map((e) => (
        <div key={e.id} className="factor fav" style={{ display: 'block' }}>
          <div className="t">{e.selection}</div>
          <div className="d">
            {e.fixture_label} · quota {e.taken_odds.toFixed(2)} (target {e.target_odds.toFixed(2)})
          </div>
          <div className="d">
            Prob. {pct(e.probability)} · Value <span className={e.value_pct >= 0 ? 'pos' : 'neg'}>{signed(e.value_pct)}</span> · {e.reliability}
          </div>
        </div>
      ))}
    </div>
  )
}
