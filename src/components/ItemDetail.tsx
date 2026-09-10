import { useEffect, useMemo, useState } from 'react'
import type { Item, ItemSeries, SeriesPoint } from '../lib/types'
import { loadSeries } from '../lib/data'
import { forecast as runForecast } from '../lib/forecast'
import { categoryLabel, count, decimal, longDate, money, pct, tidy } from '../lib/format'
import { Delta, Empty, Legend, Panel, SegmentedControl, StatTile } from './Primitives'
import { TrendChart, type TrendRow } from './TrendChart'
import { RankBars } from './RankBars'

type View = 'trend' | 'channel' | 'state' | 'table'

const VIEWS: { value: View; label: string }[] = [
  { value: 'trend', label: 'Trend & forecast' },
  { value: 'channel', label: 'Market vs shop' },
  { value: 'state', label: 'By state' },
  { value: 'table', label: 'Table' },
]

/** Stable identity for the not-yet-loaded case, so downstream memos stay valid. */
const EMPTY_SERIES: SeriesPoint[] = []

export function ItemDetail({ item, onClose }: { item: Item; onClose: () => void }) {
  const [data, setData] = useState<ItemSeries | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>('trend')

  // The caller keys this component on item.code, so a different item remounts it with
  // fresh state. That leaves this effect with nothing to reset before fetching.
  useEffect(() => {
    let live = true
    loadSeries(item.code)
      .then((d) => live && setData(d))
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [item.code])

  // A fresh `?? []` each render would give every useMemo below a new dependency, re-running
  // the forecast's parameter search on every keystroke and hover.
  const series = data?.series ?? EMPTY_SERIES

  // Partial collection days (a handful of premises) would drag the trend line and the
  // forecast around, so charts use fully surveyed days. The table still shows everything.
  const solid = useMemo(() => series.filter((p) => !p.thin), [series])
  const thinCount = series.length - solid.length

  const dates = useMemo(() => solid.map((p) => p.d), [solid])
  const values = useMemo(() => solid.map((p) => p.avg), [solid])
  // A sparse item has no trustworthy daily average, so projecting it would be false precision.
  const fc = useMemo(
    () => (values.length && !item.sparse ? runForecast(dates, values, 30) : null),
    [dates, values, item.sparse],
  )

  const trendRows = useMemo<TrendRow[]>(() => {
    const rows: TrendRow[] = solid.map((p) => ({
      d: p.d,
      actual: p.avg,
      // The interquartile range, not the outright min and max: one mispriced stall would
      // otherwise stretch the band far enough to flatten the trend line.
      band: p.p25 != null && p.p75 != null ? [p.p25, p.p75] : null,
      forecast: null,
    }))
    if (fc && rows.length) {
      const last = rows[rows.length - 1]
      last.forecast = last.actual ?? null
      for (const p of fc.points) rows.push({ d: p.d, actual: null, forecast: p.value, band: [p.lo, p.hi] })
    }
    return rows
  }, [solid, fc])

  const channelRows = useMemo<TrendRow[]>(
    () =>
      solid.map((p) => ({
        d: p.d,
        actual: p.ch.pasar?.avg ?? null,
        second: p.ch.runcit?.avg ?? null,
      })),
    [solid],
  )
  const hasChannelSplit = channelRows.some((r) => r.actual != null) && channelRows.some((r) => r.second != null)

  const stateRows = useMemo(() => {
    const last = solid[solid.length - 1]
    if (!last) return []
    return Object.entries(last.st)
      .map(([label, value]) => ({ label, value, sub: `${item.activeByState[label] ?? 0} premises` }))
      .sort((a, b) => b.value - a.value)
  }, [solid, item.activeByState])

  const latestPoint = solid[solid.length - 1]
  const perKgNote = item.kg && item.kg !== 1 ? `${money(item.latest.avg / item.kg)} per kg` : null
  const spread = item.pasar != null && item.runcit != null ? ((item.runcit - item.pasar) / item.pasar) * 100 : null
  const spreadNote =
    spread == null
      ? 'pasar basah'
      : Math.abs(spread) < 0.5
        ? 'retail costs about the same'
        : `retail costs ${decimal(Math.abs(spread))}% ${spread > 0 ? 'more' : 'less'}`

  return (
    <div className="detail">
      <header className="detail-head">
        <div>
          <p className="detail-eyebrow">{categoryLabel(item.category)}</p>
          <h2>{tidy(item.name)}</h2>
          <p className="detail-sub">
            Priced per {item.unit}
            {perKgNote ? ` · ${perKgNote}` : ''} · {count(solid.length || item.points)} fully
            surveyed days from {longDate(item.first)}
            {thinCount > 0 ? ` · ${count(thinCount)} partial days excluded from charts` : ''}
          </p>
        </div>
        <button type="button" className="ghost" onClick={onClose}>
          Close
        </button>
      </header>

      <div className="tiles">
        <StatTile
          label="Average price today"
          value={money(item.latest.avg)}
          delta={item.change30}
          deltaSuffix="in 30 days"
          sub={`${count(item.latest.n)} premises reporting`}
          tone="hero"
        />
        <StatTile label="Median" value={money(item.latest.med)} sub={`range ${money(item.latest.min)} – ${money(item.latest.max)}`} />
        <StatTile label="Wet market" value={money(item.pasar)} sub={spreadNote} />
        <StatTile label="Retail" value={money(item.runcit)} sub="supermarket, mini market, kedai runcit" />
      </div>

      {item.sparse ? (
        <p className="notice">
          This item is surveyed in only about {count(item.typicalPremises)} premises on a typical
          day, too few to support a reliable average. Prices are shown as collected, and no
          movement figures or forecast are offered.
        </p>
      ) : null}

      {error ? <Empty>{error}</Empty> : null}
      {!data && !error ? <Empty>Loading daily prices…</Empty> : null}

      {data ? (
        <>
          <div className="chart-head">
            <SegmentedControl label="Chart view" value={view} onChange={setView} options={VIEWS} />
          </div>

          {view === 'trend' ? (
            <>
              <Legend
                items={[
                  { color: 'var(--series-1)', label: 'Average across premises' },
                  ...(fc ? [{ color: 'var(--series-1)', label: 'Forecast, next 30 days', dashed: true }] : []),
                ]}
              />
              <p className="disclaimer band-note">
                The shaded band covers the middle half of reporting premises, so half of all shops
                priced within it. Today that is {money(latestPoint?.p25)} to {money(latestPoint?.p75)}.
              </p>
              <TrendChart
                rows={trendRows}
                format={(v) => money(v)}
                primaryLabel="Average"
                bandLabel="Middle half of premises"
                forecastLabel="Forecast"
                splitAt={item.latest.date}
                yLabel={`RM per ${item.unit}`}
              />
              {fc ? (
                <div className="callout">
                  <p>
                    Thirty days out the model puts this at <strong>{money(fc.points[fc.points.length - 1].value)}</strong>{' '}
                    per {item.unit}, {pct(fc.changePct)} against today, with a 95% interval of{' '}
                    {money(fc.points[fc.points.length - 1].lo)} to {money(fc.points[fc.points.length - 1].hi)}.
                    {fc.mape != null ? ` Backtested error was ${decimal(fc.mape)}% over ${fc.holdout} held-out days.` : ''}
                  </p>
                </div>
              ) : null}
            </>
          ) : null}

          {view === 'channel' ? (
            hasChannelSplit ? (
              <>
                <Legend
                  items={[
                    { color: 'var(--series-1)', label: 'Pasar basah (wet market)' },
                    { color: 'var(--series-2)', label: 'Runcit (retail)' },
                  ]}
                />
                <TrendChart
                  rows={channelRows}
                  format={(v) => money(v)}
                  primaryLabel="Pasar basah"
                  secondLabel="Runcit"
                  yLabel={`RM per ${item.unit}`}
                />
                <p className="disclaimer">
                  PriceCatcher records no wholesale (borong) prices for this item, so the wet market
                  average stands in as the closest thing to a farmgate reference.
                </p>
              </>
            ) : (
              <Empty>This item is only surveyed in one channel, so there is nothing to compare.</Empty>
            )
          ) : null}

          {view === 'state' ? (
            stateRows.length ? (
              <>
                <RankBars rows={stateRows} format={(v) => money(v)} />
                <p className="disclaimer">
                  Average price on {longDate(item.latest.date)}. States with few reporting premises will
                  swing more from day to day.
                </p>
              </>
            ) : (
              <Empty>No state breakdown available for the latest day.</Empty>
            )
          ) : null}

          {view === 'table' ? (
            <div className="table-scroll">
              <table className="data-table">
                <caption className="sr-only">Daily prices for {tidy(item.name)}</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Average</th>
                    <th scope="col">Median</th>
                    <th scope="col">Cheapest</th>
                    <th scope="col">Dearest</th>
                    <th scope="col">Wet market</th>
                    <th scope="col">Retail</th>
                    <th scope="col">Premises</th>
                  </tr>
                </thead>
                <tbody>
                  {[...series].reverse().slice(0, 60).map((p) => (
                    <tr key={p.d} className={p.thin ? 'row-thin' : undefined}>
                      <th scope="row">
                        {longDate(p.d)}
                        {p.thin ? <span className="row-flag"> partial</span> : null}
                      </th>
                      <td className="tnum">{money(p.avg)}</td>
                      <td className="tnum">{money(p.med)}</td>
                      <td className="tnum">{money(p.min)}</td>
                      <td className="tnum">{money(p.max)}</td>
                      <td className="tnum">{money(p.ch.pasar?.avg ?? null)}</td>
                      <td className="tnum">{money(p.ch.runcit?.avg ?? null)}</td>
                      <td className="tnum">{count(p.n)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {view === 'table' && thinCount > 0 ? (
            <p className="disclaimer">
              Days marked partial were only a small collection round, so their average covers far
              fewer premises than usual. They are listed here but left out of every chart.
            </p>
          ) : null}
        </>
      ) : null}

      <Panel title="Reach" note="How widely this item is surveyed.">
        <div className="tiles">
          <StatTile label="Premises in the last 30 days" value={count(item.activePremises)} />
          <StatTile label="States covered" value={String(Object.keys(item.activeByState).length)} />
          <StatTile label="Change over 7 days" value={<Delta value={item.change7} />} />
          <StatTile label="Change over 90 days" value={<Delta value={item.change90} />} />
        </div>
      </Panel>
    </div>
  )
}
