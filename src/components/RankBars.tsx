/**
 * Horizontal ranked bars on a single sequential hue: more is darker.
 * Direct-labelled, so the chart stays readable without relying on colour.
 */
export interface RankRow {
  label: string
  value: number
  /** Optional secondary line under the label, e.g. a sample count. */
  sub?: string
  /** Unique React key. Falls back to the label, which must then be unique. */
  id?: string | number
}

const RAMP = ['var(--seq-100)', 'var(--seq-250)', 'var(--seq-400)', 'var(--seq-550)', 'var(--seq-700)']

export function RankBars({
  rows,
  format,
  max,
}: {
  rows: RankRow[]
  format: (v: number) => string
  max?: number
}) {
  if (!rows.length) return null
  const hi = max ?? Math.max(...rows.map((r) => r.value))
  const lo = Math.min(...rows.map((r) => r.value))
  const span = hi - lo || 1
  return (
    <ul className="rankbars">
      {rows.map((r) => {
        const stepIndex = Math.min(RAMP.length - 1, Math.floor(((r.value - lo) / span) * RAMP.length))
        return (
          <li key={r.id ?? r.label}>
            <span className="rank-label">
              {r.label}
              {r.sub ? <span className="rank-sub">{r.sub}</span> : null}
            </span>
            <span className="rank-track">
              <span
                className="rank-fill"
                style={{ width: `${Math.max(2, (r.value / hi) * 100)}%`, background: RAMP[stepIndex] }}
              />
            </span>
            <span className="rank-value tnum">{format(r.value)}</span>
          </li>
        )
      })}
    </ul>
  )
}
