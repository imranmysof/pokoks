import { useMemo, useState } from 'react'
import type { Item, PalmData } from '../lib/types'
import { forecast as runForecast } from '../lib/forecast'
import { decimal, longDate, money, moneyWhole, pct, shortDate, tidy } from '../lib/format'
import { Legend, Panel, SegmentedControl, StatTile } from './Primitives'
import { TrendChart, type TrendRow } from './TrendChart'
import type { RankRow } from './RankBars'
import { RankBars } from './RankBars'

type Basis = 'cpo' | 'ffb'
type Horizon = '14' | '30' | '60'

const HORIZONS: { value: Horizon; label: string }[] = [
  { value: '14', label: '2 weeks' },
  { value: '30', label: '1 month' },
  { value: '60', label: '2 months' },
]

/** Yield assumptions used to turn a per-tonne FFB price into a per-hectare income estimate. */
const FFB_YIELD_TONNES_PER_HA = 16.5

export function PalmPanel({ palm, items }: { palm: PalmData; items: Item[] }) {
  const [basis, setBasis] = useState<Basis>('cpo')
  const [horizon, setHorizon] = useState<Horizon>('30')

  const series = palm.series
  const dates = useMemo(() => series.map((p) => p.date), [series])
  const values = useMemo(
    () => series.map((p) => (basis === 'cpo' ? p.cpo_rm_per_tonne : p.ffb_rm_per_tonne)),
    [series, basis],
  )

  const fc = useMemo(() => runForecast(dates, values, Number(horizon)), [dates, values, horizon])

  const rows = useMemo<TrendRow[]>(() => {
    const observed: TrendRow[] = series.map((p, i) => ({
      d: p.date,
      actual: values[i],
      forecast: null,
      band: null,
    }))
    if (fc && observed.length) {
      const last = observed[observed.length - 1]
      last.forecast = last.actual ?? null
      last.band = last.actual != null ? [last.actual, last.actual] : null
      for (const p of fc.points) {
        observed.push({ d: p.d, actual: null, forecast: p.value, band: [p.lo, p.hi] })
      }
    }
    return observed
  }, [series, values, fc])

  const latest = series[series.length - 1]
  const latestValue = values[values.length - 1]
  const valueAgo = (days: number) => {
    const target = new Date(Date.parse(latest.date) - days * 86400000).toISOString().slice(0, 10)
    let hit: number | null = null
    for (let i = 0; i < series.length; i++) {
      if (series[i].date <= target) hit = values[i]
      else break
    }
    return hit
  }
  const change = (days: number) => {
    const prior = valueAgo(days)
    return prior == null ? null : ((latestValue - prior) / prior) * 100
  }

  const unitLabel = basis === 'cpo' ? 'Crude palm oil' : 'Fresh fruit bunch (estimated)'
  const fmtTonne = (v: number) => moneyWhole(v)
  const perKg = latestValue / 1000

  // Palm cooking oil at the shop counter, as the downstream half of the same value chain.
  // The generic 1 kg polybag sells at a government-set ceiling price, so it is held out of
  // the market average and reported on its own.
  const isSubsidised = (name: string) => /PAKET/i.test(name) && /PELBAGAI JENAMA/i.test(name)

  const allOil = useMemo(() => items.filter((i) => i.palm && i.kg), [items])
  const subsidised = useMemo(() => allOil.find((i) => isSubsidised(i.name)) ?? null, [allOil])
  const oilItems = useMemo(
    () =>
      allOil
        .filter((i) => !isSubsidised(i.name))
        .sort((a, b) => (b.activePremises ?? 0) - (a.activePremises ?? 0)),
    [allOil],
  )
  const oilPerKg = useMemo<RankRow[]>(
    () =>
      oilItems
        .slice(0, 8)
        .map((i) => ({
          id: i.code,
          label: `${tidy(i.name.replace(/^MINYAK MASAK\s*/i, '').replace(/\s+CAP\s+/i, ' '))} · ${i.unit}`,
          value: i.latest.avg / (i.kg as number),
          sub: `${money(i.latest.avg)} a pack · ${i.latest.n} premises`,
        }))
        .sort((a, b) => b.value - a.value),
    [oilItems],
  )
  const oilAvgPerKg = oilItems.length
    ? oilItems.reduce((s, i) => s + i.latest.avg / (i.kg as number), 0) / oilItems.length
    : null

  // Mill gate to shop shelf: what a kilogram of palm oil costs at each end of the chain.
  // Always compares against crude palm oil, never the fresh fruit bunch price, regardless
  // of which basis the chart above is showing.
  const cpoPerKg = latest.cpo_rm_per_tonne / 1000
  const markup = oilAvgPerKg != null ? ((oilAvgPerKg - cpoPerKg) / cpoPerKg) * 100 : null

  const incomePerHa = (latest.ffb_rm_per_tonne * FFB_YIELD_TONNES_PER_HA) / 12

  return (
    <>
      <Panel
        title="Palm oil price and outlook"
        note={
          <>
            Malaysia daily average from MPOB, last updated {longDate(latest.date)}. Fresh fruit bunch
            prices here are derived from crude palm oil, not the official reference price.
          </>
        }
        actions={
          <SegmentedControl
            label="Price basis"
            value={basis}
            onChange={setBasis}
            options={[
              { value: 'cpo', label: 'Crude palm oil' },
              { value: 'ffb', label: 'Fresh fruit bunch' },
            ]}
          />
        }
      >
        <div className="tiles">
          <StatTile
            label={`${unitLabel} · RM per tonne`}
            value={fmtTonne(latestValue)}
            delta={change(30)}
            deltaSuffix="in 30 days"
            polarity="income"
            sub={shortDate(latest.date)}
            tone="hero"
          />
          <StatTile label="Per kilogram" value={money(perKg)} sub="same basis, converted" />
          <StatTile label="Change over 7 days" value={pct(change(7))} sub={`from ${fmtTonne(valueAgo(7) ?? latestValue)}`} />
          <StatTile label="Change over 90 days" value={pct(change(90))} sub={`from ${fmtTonne(valueAgo(90) ?? latestValue)}`} />
        </div>

        <div className="chart-head">
          <Legend
            items={[
              { color: 'var(--series-1)', label: `${unitLabel} observed` },
              { color: 'var(--series-1)', label: `Forecast, next ${HORIZONS.find((h) => h.value === horizon)?.label}`, dashed: true },
            ]}
          />
          <SegmentedControl label="Forecast horizon" value={horizon} onChange={setHorizon} options={HORIZONS} />
        </div>

        <TrendChart
          rows={rows}
          format={fmtTonne}
          primaryLabel={`${unitLabel} (RM/t)`}
          forecastLabel="Forecast"
          bandLabel="95% interval"
          splitAt={latest.date}
          height={320}
          yLabel="RM per tonne"
        />

        {fc ? (
          <div className="callout">
            <p>
              The model projects {fc.direction === 'flat' ? 'little movement' : `prices ${fc.direction}`} to{' '}
              <strong>{fmtTonne(fc.points[fc.points.length - 1].value)}</strong> per tonne by{' '}
              {longDate(fc.points[fc.points.length - 1].d)}, a change of {pct(fc.changePct)}. The shaded
              band is the 95% interval, running {fmtTonne(fc.points[fc.points.length - 1].lo)} to{' '}
              {fmtTonne(fc.points[fc.points.length - 1].hi)}.
            </p>
            <dl className="model-facts">
              <div>
                <dt>Method</dt>
                <dd>Damped-trend exponential smoothing</dd>
              </div>
              <div>
                <dt>Backtest error</dt>
                <dd>{fc.mape == null ? 'not enough history' : `${decimal(fc.mape)}% over ${fc.holdout} held-out days`}</dd>
              </div>
              <div>
                <dt>Daily noise</dt>
                <dd>{fmtTonne(fc.sigma)} standard deviation</dd>
              </div>
            </dl>
            <p className="disclaimer">
              This is a statistical extrapolation of past prices. It knows nothing about weather,
              export duty, stock levels or soybean oil, so treat it as a baseline, not advice.
            </p>
          </div>
        ) : null}
      </Panel>

      <Panel
        title="What a smallholder sees"
        note="Indicative farmgate arithmetic built on the derived fresh fruit bunch price."
      >
        <div className="tiles">
          <StatTile label="Fresh fruit bunch, per tonne" value={moneyWhole(latest.ffb_rm_per_tonne)} sub="derived from crude palm oil" />
          <StatTile label="Fresh fruit bunch, per kilogram" value={money(latest.ffb_rm_per_tonne / 1000)} sub="same figure, per kg" />
          <StatTile
            label="Gross income per hectare"
            value={moneyWhole(incomePerHa)}
            sub={`per month at ${decimal(FFB_YIELD_TONNES_PER_HA)} t/ha per year`}
          />
          <StatTile
            label="Two hectare holding"
            value={moneyWhole(incomePerHa * 2)}
            sub="per month, before costs"
          />
        </div>
        <p className="disclaimer">
          Gross revenue only. Harvesting, transport, fertiliser and mill deductions are not subtracted,
          and the oil extraction rate used is {decimal(palm.ffb.oer * 100)}% with{' '}
          {decimal(palm.ffb.millingShare * 100)}% of oil value assumed to reach the grower. Adjust both
          in the fetch script if your mill pays differently.
        </p>
      </Panel>

      <Panel
        title="From mill gate to shop shelf"
        note="Palm cooking oil prices surveyed by PriceCatcher, normalised to ringgit per kilogram."
      >
        <div className="tiles">
          <StatTile label="Crude palm oil, per kg" value={money(cpoPerKg)} sub="MPOB mill gate" />
          <StatTile
            label="Cooking oil at retail, per kg"
            value={money(oilAvgPerKg)}
            sub={`average of ${oilItems.length} unsubsidised packs`}
          />
          <StatTile
            label="Refining and retail margin"
            value={oilAvgPerKg == null ? '—' : money(oilAvgPerKg - cpoPerKg)}
            sub={`per kg, ${pct(markup)} over mill gate`}
          />
          <StatTile
            label="Subsidised 1 kg packet"
            value={money(subsidised?.latest.avg)}
            sub={subsidised ? 'price-controlled ceiling' : 'not surveyed'}
          />
        </div>
        <RankBars rows={oilPerKg} format={(v) => money(v)} />
        <p className="disclaimer">
          The generic 1 kg polybag sells at a government ceiling price, so it is excluded from the
          retail average above. Bottled and jerrycan oil moves with the market.
        </p>
      </Panel>
    </>
  )
}
