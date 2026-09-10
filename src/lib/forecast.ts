/**
 * Damped-trend exponential smoothing (Holt with a damping factor) plus a residual
 * based prediction interval, and a hold-out backtest so the UI can state how well
 * the model actually did rather than implying certainty.
 *
 * Deliberately simple: daily agricultural price series are short, noisy and have no
 * reliable weekly seasonality once averaged across hundreds of premises, so a damped
 * trend beats anything heavier here and never runs away on a long horizon.
 */

export interface ForecastPoint {
  /** ISO date. */
  d: string
  value: number
  lo: number
  hi: number
}

export interface ForecastResult {
  points: ForecastPoint[]
  /** Fitted smoothing parameters. */
  params: { alpha: number; beta: number; phi: number }
  /** Standard deviation of one-step-ahead residuals, in price units. */
  sigma: number
  /** Mean absolute percentage error from the hold-out backtest, or null when too short. */
  mape: number | null
  /** Number of points held out for the backtest. */
  holdout: number
  /** Direction of the fitted trend over the horizon. */
  direction: 'rising' | 'falling' | 'flat'
  /** Percent change from the last observed value to the final forecast point. */
  changePct: number
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

/** One pass of damped Holt. Returns fitted level, trend and one-step residuals. */
function holt(y: number[], alpha: number, beta: number, phi: number) {
  let level = y[0]
  let trend = y.length > 1 ? y[1] - y[0] : 0
  const residuals: number[] = []
  for (let i = 1; i < y.length; i++) {
    const forecast = level + phi * trend
    residuals.push(y[i] - forecast)
    const prevLevel = level
    level = alpha * y[i] + (1 - alpha) * forecast
    trend = beta * (level - prevLevel) + (1 - beta) * phi * trend
  }
  return { level, trend, residuals }
}

function sse(residuals: number[]) {
  return residuals.reduce((s, r) => s + r * r, 0)
}

/** Grid search the smoothing parameters against one-step-ahead squared error. */
function fit(y: number[]) {
  let best = { alpha: 0.3, beta: 0.1, phi: 0.9, score: Infinity }
  for (let a = 0.05; a <= 0.95; a += 0.05) {
    for (let b = 0; b <= 0.5; b += 0.05) {
      for (let p = 0.75; p <= 1.0; p += 0.05) {
        const score = sse(holt(y, a, b, p).residuals)
        if (score < best.score) best = { alpha: a, beta: b, phi: p, score }
      }
    }
  }
  return best
}

function project(y: number[], alpha: number, beta: number, phi: number, horizon: number) {
  const { level, trend } = holt(y, alpha, beta, phi)
  const out: number[] = []
  let damped = 0
  for (let h = 1; h <= horizon; h++) {
    damped += Math.pow(phi, h)
    out.push(level + damped * trend)
  }
  return out
}

/** Median gap in days between consecutive observations. */
function medianStepDays(dates: string[]) {
  if (dates.length < 2) return 1
  const gaps: number[] = []
  for (let i = 1; i < dates.length; i++) {
    const g = (Date.parse(dates[i]) - Date.parse(dates[i - 1])) / 86400000
    if (g > 0) gaps.push(g)
  }
  if (!gaps.length) return 1
  gaps.sort((a, b) => a - b)
  return Math.max(1, Math.round(gaps[gaps.length >> 1]))
}

/**
 * @param dates ISO dates, ascending, matching `values`.
 * @param values Observed prices.
 * @param horizon How many future observations to project.
 */
export function forecast(dates: string[], values: number[], horizon = 30): ForecastResult | null {
  const n = values.length
  if (n < 10) return null

  const { alpha, beta, phi } = fit(values)
  const { residuals } = holt(values, alpha, beta, phi)
  const variance = sse(residuals) / Math.max(1, residuals.length - 1)
  const sigma = Math.sqrt(variance)

  // Hold-out backtest: refit on everything but the tail, score against the tail.
  const holdout = clamp(Math.floor(n * 0.2), 0, 21)
  let mape: number | null = null
  if (holdout >= 5 && n - holdout >= 10) {
    const train = values.slice(0, n - holdout)
    const test = values.slice(n - holdout)
    const f = fit(train)
    const predicted = project(train, f.alpha, f.beta, f.phi, holdout)
    let sum = 0
    let count = 0
    for (let i = 0; i < test.length; i++) {
      if (test[i] === 0) continue
      sum += Math.abs((test[i] - predicted[i]) / test[i])
      count++
    }
    if (count) mape = (sum / count) * 100
  }

  const projected = project(values, alpha, beta, phi, horizon)
  const step = medianStepDays(dates)
  const lastDate = Date.parse(dates[dates.length - 1])
  const points: ForecastPoint[] = projected.map((value, i) => {
    // Interval widens with the horizon: sigma * sqrt(h), the standard random-walk growth.
    const spread = 1.96 * sigma * Math.sqrt(i + 1)
    return {
      d: new Date(lastDate + (i + 1) * step * 86400000).toISOString().slice(0, 10),
      value: Math.max(0, value),
      lo: Math.max(0, value - spread),
      hi: value + spread,
    }
  })

  const last = values[n - 1]
  const end = points[points.length - 1].value
  const changePct = ((end - last) / last) * 100
  const direction = Math.abs(changePct) < 0.5 ? 'flat' : changePct > 0 ? 'rising' : 'falling'

  return { points, params: { alpha, beta, phi }, sigma, mape, holdout, direction, changePct }
}

/** Ordinary least squares slope per day, useful for a plain-language trend statement. */
export function trendPerDay(dates: string[], values: number[]): number {
  const n = values.length
  if (n < 2) return 0
  const t0 = Date.parse(dates[0])
  const xs = dates.map((d) => (Date.parse(d) - t0) / 86400000)
  const mx = xs.reduce((s, x) => s + x, 0) / n
  const my = values.reduce((s, y) => s + y, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (values[i] - my)
    den += (xs[i] - mx) ** 2
  }
  return den === 0 ? 0 : num / den
}
