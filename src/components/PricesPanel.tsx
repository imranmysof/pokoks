import { useMemo, useState } from 'react'
import type { Item } from '../lib/types'
import { categoryLabel, count, money, pct, tidy } from '../lib/format'
import { Delta, Empty, Panel, Sparkline, StatTile } from './Primitives'

type SortKey = 'name' | 'price' | 'change7' | 'change30' | 'premises'

/** Minimum reporting premises before an item is allowed to headline the market pulse. */
const MIN_PREMISES_FOR_HEADLINE = 100

export function PricesPanel({ items, onSelect }: { items: Item[]; onSelect: (item: Item) => void }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [sort, setSort] = useState<SortKey>('change30')
  const [desc, setDesc] = useState(true)

  const categories = useMemo(() => {
    const set = new Map<string, number>()
    for (const i of items) set.set(i.category, (set.get(i.category) ?? 0) + 1)
    return [...set.entries()].sort((a, b) => categoryLabel(a[0]).localeCompare(categoryLabel(b[0])))
  }, [items])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = items.filter(
      (i) =>
        (category === 'all' || i.category === category) &&
        (!q || i.name.toLowerCase().includes(q) || categoryLabel(i.category).toLowerCase().includes(q)),
    )
    const dir = desc ? -1 : 1
    const key = (i: Item) => {
      switch (sort) {
        case 'name':
          return i.name
        case 'price':
          return i.kg ? i.latest.avg / i.kg : i.latest.avg
        case 'change7':
          return i.change7 ?? -Infinity
        case 'change30':
          return i.change30 ?? -Infinity
        case 'premises':
          return i.activePremises
      }
    }
    return [...rows].sort((a, b) => {
      const ka = key(a)
      const kb = key(b)
      if (typeof ka === 'string' || typeof kb === 'string') return String(ka).localeCompare(String(kb)) * dir
      return (ka - kb) * dir
    })
  }, [items, query, category, sort, desc])

  const movers = useMemo(() => {
    // A thinly surveyed item swings wildly on one shop's price, which would otherwise
    // capture every headline. Require a reasonable panel before an item can top the list.
    const wellSurveyed = items.filter((i) => i.activePremises >= MIN_PREMISES_FOR_HEADLINE)
    const withChange = (wellSurveyed.length ? wellSurveyed : items).filter((i) => i.change30 != null)
    const up = [...withChange].sort((a, b) => (b.change30 as number) - (a.change30 as number))[0]
    const down = [...withChange].sort((a, b) => (a.change30 as number) - (b.change30 as number))[0]
    const busiest = [...items].sort((a, b) => b.activePremises - a.activePremises)[0]
    const median = (() => {
      const changes = withChange.map((i) => i.change30 as number).sort((a, b) => a - b)
      if (!changes.length) return null
      const m = changes.length >> 1
      return changes.length % 2 ? changes[m] : (changes[m - 1] + changes[m]) / 2
    })()
    return { up, down, busiest, median }
  }, [items])

  const toggleSort = (key: SortKey) => {
    if (key === sort) setDesc(!desc)
    else {
      setSort(key)
      setDesc(key !== 'name')
    }
  }

  const sortIndicator = (key: SortKey) => (key === sort ? (desc ? ' ▼' : ' ▲') : '')

  return (
    <>
      <Panel
        title="Market pulse"
        note={`Across every agriculture and horticulture item in the survey. Movers are limited to items reported by at least ${MIN_PREMISES_FOR_HEADLINE} premises.`}
      >
        <div className="tiles">
          <StatTile
            label="Typical 30 day move"
            value={pct(movers.median)}
            sub={`median across ${items.length} items`}
            tone="hero"
          />
          {movers.up ? (
            <StatTile
              label="Biggest rise"
              value={tidy(movers.up.name)}
              delta={movers.up.change30}
              sub={`${money(movers.up.latest.avg)} · ${count(movers.up.activePremises)} premises`}
              spark={movers.up.spark}
            />
          ) : null}
          {movers.down ? (
            <StatTile
              label="Biggest fall"
              value={tidy(movers.down.name)}
              delta={movers.down.change30}
              sub={`${money(movers.down.latest.avg)} · ${count(movers.down.activePremises)} premises`}
              spark={movers.down.spark}
            />
          ) : null}
          {movers.busiest ? (
            <StatTile
              label="Most widely surveyed"
              value={tidy(movers.busiest.name)}
              sub={`${count(movers.busiest.activePremises)} premises in 30 days`}
            />
          ) : null}
        </div>
      </Panel>

      <Panel
        title="All tracked items"
        note="Select any row for daily history, a channel comparison, a state breakdown and a 30 day forecast."
        actions={
          <div className="filters">
            <label className="field">
              <span className="sr-only">Search items</span>
              <input
                type="search"
                placeholder="Search, e.g. cili, bayam, beras"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="sr-only">Filter by category</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="all">All categories ({items.length})</option>
                {categories.map(([c, n]) => (
                  <option key={c} value={c}>
                    {categoryLabel(c)} ({n})
                  </option>
                ))}
              </select>
            </label>
          </div>
        }
      >
        {filtered.length === 0 ? (
          <Empty>Nothing matches that search.</Empty>
        ) : (
          <div className="table-scroll">
            <table className="data-table selectable">
              <caption className="sr-only">Agriculture and horticulture prices, sorted by {sort}</caption>
              <thead>
                <tr>
                  <th scope="col">
                    <button type="button" className="th-sort" onClick={() => toggleSort('name')}>
                      Item{sortIndicator('name')}
                    </button>
                  </th>
                  <th scope="col">Unit</th>
                  <th scope="col">
                    <button type="button" className="th-sort" onClick={() => toggleSort('price')}>
                      Price{sortIndicator('price')}
                    </button>
                  </th>
                  <th scope="col">Per kg</th>
                  <th scope="col">Wet market</th>
                  <th scope="col">Retail</th>
                  <th scope="col">
                    <button type="button" className="th-sort" onClick={() => toggleSort('change7')}>
                      7 days{sortIndicator('change7')}
                    </button>
                  </th>
                  <th scope="col">
                    <button type="button" className="th-sort" onClick={() => toggleSort('change30')}>
                      30 days{sortIndicator('change30')}
                    </button>
                  </th>
                  <th scope="col">
                    <button type="button" className="th-sort" onClick={() => toggleSort('premises')}>
                      Premises{sortIndicator('premises')}
                    </button>
                  </th>
                  <th scope="col">Last 30 days</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => (
                  <tr key={i.code} onClick={() => onSelect(i)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onSelect(i)}>
                    <th scope="row">
                      <span className="row-name">{tidy(i.name)}</span>
                      <span className="row-cat">{categoryLabel(i.category)}</span>
                    </th>
                    <td className="muted">{i.unit}</td>
                    <td className="tnum">{money(i.latest.avg)}</td>
                    <td className="tnum muted">{i.kg && i.kg !== 1 ? money(i.latest.avg / i.kg) : '—'}</td>
                    <td className="tnum">{money(i.pasar)}</td>
                    <td className="tnum">{money(i.runcit)}</td>
                    <td>
                      <Delta value={i.change7} />
                    </td>
                    <td>
                      <Delta value={i.change30} />
                    </td>
                    <td className="tnum muted">{count(i.activePremises)}</td>
                    <td>
                      <Sparkline values={i.spark} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  )
}
