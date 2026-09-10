import type { ReactNode } from 'react'
import { pct } from '../lib/format'

/**
 * Whether a rising number is bad news, good news, or neither. A shopper reads a rising
 * vegetable price as bad; a grower reads a rising palm price as good. Getting this wrong
 * paints a value judgement the data does not carry.
 */
export type Polarity = 'cost' | 'income' | 'neutral'

/** A signed percentage change, given a text arrow so colour is never the only cue. */
export function Delta({
  value,
  suffix,
  polarity = 'cost',
}: {
  value: number | null | undefined
  suffix?: string
  polarity?: Polarity
}) {
  if (value == null || !Number.isFinite(value)) return <span className="delta delta-flat">—</span>
  const rising = value > 0
  const flat = Math.abs(value) < 0.05
  const glyph = flat ? '=' : rising ? '▲' : '▼'
  const tone = flat || polarity === 'neutral' ? 'flat' : polarity === 'cost' ? (rising ? 'up' : 'down') : rising ? 'down' : 'up'
  return (
    <span className={`delta delta-${tone} tnum`}>
      <span aria-hidden="true">{glyph}</span> {pct(value)}
      {suffix ? <span className="delta-suffix"> {suffix}</span> : null}
    </span>
  )
}

/** Minimal trend line for a table row or a stat tile. Decorative only, so it is hidden from AT. */
export function Sparkline({
  values,
  width = 84,
  height = 26,
}: {
  values: number[]
  width?: number
  height?: number
}) {
  if (values.length < 2) return <svg width={width} height={height} aria-hidden="true" />
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const step = width / (values.length - 1)
  const pad = 3
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2)
  const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(2)},${y(v).toFixed(2)}`).join(' ')
  const rising = values[values.length - 1] >= values[0]
  return (
    <svg width={width} height={height} aria-hidden="true" className="sparkline">
      <path d={d} fill="none" stroke={rising ? 'var(--series-2)' : 'var(--series-1)'} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={(values.length - 1) * step} cy={y(values[values.length - 1])} r="2.5" fill={rising ? 'var(--series-2)' : 'var(--series-1)'} />
    </svg>
  )
}

export function StatTile({
  label,
  value,
  sub,
  delta,
  deltaSuffix,
  polarity,
  spark,
  tone,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  delta?: number | null
  deltaSuffix?: string
  polarity?: Polarity
  spark?: number[]
  tone?: 'hero'
}) {
  return (
    <div className={`tile${tone === 'hero' ? ' tile-hero' : ''}`}>
      <div className="tile-label">{label}</div>
      <div className="tile-value tnum">{value}</div>
      <div className="tile-foot">
        {delta !== undefined ? <Delta value={delta} suffix={deltaSuffix} polarity={polarity} /> : null}
        {sub ? <span className="tile-sub">{sub}</span> : null}
        {spark && spark.length > 1 ? <Sparkline values={spark} /> : null}
      </div>
    </div>
  )
}

export function Panel({
  title,
  note,
  actions,
  children,
}: {
  title: string
  note?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <h2>{title}</h2>
          {note ? <p className="panel-note">{note}</p> : null}
        </div>
        {actions ? <div className="panel-actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  )
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={o.value === value ? 'seg-on' : undefined}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Legend({ items }: { items: { color: string; label: string; dashed?: boolean }[] }) {
  return (
    <ul className="legend">
      {items.map((i) => (
        <li key={i.label}>
          <span
            className="legend-swatch"
            style={{
              background: i.dashed ? 'transparent' : i.color,
              borderTop: i.dashed ? `2px dashed ${i.color}` : undefined,
            }}
            aria-hidden="true"
          />
          {i.label}
        </li>
      ))}
    </ul>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}
