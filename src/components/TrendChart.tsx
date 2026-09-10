import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { shortDate } from '../lib/format'

export interface TrendRow {
  d: string
  /** Observed value. Absent on forecast rows so the solid line stops cleanly. */
  actual?: number | null
  /** Projected value. Present on the join point too, so the dashed line connects. */
  forecast?: number | null
  /** Optional shaded range, as [low, high]. */
  band?: [number, number] | null
  /** Optional second observed series. */
  second?: number | null
}

interface Props {
  rows: TrendRow[]
  format: (v: number) => string
  height?: number
  /** Label for the primary series, used in the tooltip. */
  primaryLabel: string
  secondLabel?: string
  bandLabel?: string
  forecastLabel?: string
  /** Draws a vertical rule at this date, marking where observation ends. */
  splitAt?: string | null
  yLabel?: string
  /** Lowest value the axis may show. Defaults to 0, since a price cannot be negative. */
  floor?: number
}

/** Recharts injects `active`, `payload` and `label` into whatever element is passed as `content`. */
interface TooltipInjected {
  active?: boolean
  payload?: { payload: TrendRow }[]
  label?: string | number
}

function ChartTooltip({
  active,
  payload,
  label,
  format,
  primaryLabel,
  secondLabel,
  bandLabel,
  forecastLabel,
}: TooltipInjected & {
  format: (v: number) => string
  primaryLabel: string
  secondLabel?: string
  bandLabel?: string
  forecastLabel?: string
}) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  const lines: { label: string; value: string; color: string }[] = []
  if (row.actual != null) lines.push({ label: primaryLabel, value: format(row.actual), color: 'var(--series-1)' })
  if (row.second != null && secondLabel) lines.push({ label: secondLabel, value: format(row.second), color: 'var(--series-2)' })
  if (row.actual == null && row.forecast != null) {
    lines.push({ label: forecastLabel ?? 'Forecast', value: format(row.forecast), color: 'var(--series-1)' })
  }
  if (row.band && row.actual == null) {
    lines.push({ label: bandLabel ?? 'Range', value: `${format(row.band[0])} – ${format(row.band[1])}`, color: 'var(--text-muted)' })
  } else if (row.band && row.actual != null) {
    lines.push({ label: bandLabel ?? 'Range', value: `${format(row.band[0])} – ${format(row.band[1])}`, color: 'var(--text-muted)' })
  }
  if (!lines.length) return null
  return (
    <div className="tooltip">
      <div className="tooltip-date">{new Date(String(label)).toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</div>
      {lines.map((l) => (
        <div key={l.label} className="tooltip-row">
          <span className="tooltip-swatch" style={{ background: l.color }} aria-hidden="true" />
          <span className="tooltip-label">{l.label}</span>
          <span className="tooltip-value tnum">{l.value}</span>
        </div>
      ))}
    </div>
  )
}

export function TrendChart({
  rows,
  format,
  height = 300,
  primaryLabel,
  secondLabel,
  bandLabel,
  forecastLabel,
  splitAt,
  yLabel,
  floor = 0,
}: Props) {
  const values = rows.flatMap((r) =>
    [r.actual, r.forecast, r.second, r.band?.[0], r.band?.[1]].filter((v): v is number => v != null),
  )
  const min = Math.min(...values)
  const max = Math.max(...values)
  const pad = (max - min || max || 1) * 0.08
  const domain: [number, number] = [Math.max(floor, min - pad), max + pad]

  return (
    <div className="chart" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis
            dataKey="d"
            tickFormatter={shortDate}
            stroke="var(--border-strong)"
            tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
            tickLine={false}
            minTickGap={44}
          />
          <YAxis
            domain={domain}
            tickFormatter={format}
            stroke="var(--border-strong)"
            tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={72}
            label={
              yLabel
                ? { value: yLabel, angle: -90, position: 'insideLeft', fill: 'var(--text-muted)', fontSize: 11, offset: 10 }
                : undefined
            }
          />
          <Tooltip
            cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
            content={
              <ChartTooltip
                format={format}
                primaryLabel={primaryLabel}
                secondLabel={secondLabel}
                bandLabel={bandLabel}
                forecastLabel={forecastLabel}
              />
            }
          />
          <Area
            dataKey="band"
            stroke="none"
            fill="var(--band)"
            isAnimationActive={false}
            connectNulls
            activeDot={false}
          />
          {splitAt ? <ReferenceLine x={splitAt} stroke="var(--border-strong)" strokeDasharray="3 3" /> : null}
          <Line
            dataKey="actual"
            stroke="var(--series-1)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface-1)' }}
            isAnimationActive={false}
            connectNulls={false}
          />
          {rows.some((r) => r.second != null) ? (
            <Line
              dataKey="second"
              stroke="var(--series-2)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface-1)' }}
              isAnimationActive={false}
              connectNulls={false}
            />
          ) : null}
          {rows.some((r) => r.forecast != null) ? (
            <Line
              dataKey="forecast"
              stroke="var(--series-1)"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface-1)' }}
              isAnimationActive={false}
              connectNulls
            />
          ) : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
