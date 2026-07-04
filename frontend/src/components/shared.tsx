export const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`

export function ReliabilityBadge({ level }: { level: string }) {
  const cls =
    level === 'Molto alta' ? 'badge-green'
    : level === 'Alta' ? 'badge-blue'
    : level === 'Media' ? 'badge-amber'
    : 'badge-red'
  return <span className={`badge ${cls}`}>Affidabilità {level}</span>
}

export function FormString({ value }: { value: string }) {
  return (
    <span className="form-string">
      {value.split('').map((c, i) => (
        <span key={i} className={c}>{c}</span>
      ))}
    </span>
  )
}

export function ProbBar({ value }: { value: number }) {
  return (
    <div className="prob-bar">
      <div style={{ width: `${Math.min(100, value * 100)}%` }} />
    </div>
  )
}

export function signed(v: number, digits = 1) {
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`
}
