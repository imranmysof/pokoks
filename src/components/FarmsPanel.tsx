import { useMemo, useState } from 'react'
import type { CropsData, Item, Meta } from '../lib/types'
import { count, decimal, tidy } from '../lib/format'
import { Empty, Panel, SegmentedControl, StatTile } from './Primitives'
import { RankBars } from './RankBars'

type Measure = 'production' | 'planted_area'

const CROP_LABEL: Record<string, string> = {
  cash_crops: 'Cash crops',
  coconut: 'Coconut',
  flower: 'Flowers',
  fruits: 'Fruit',
  herbs: 'Herbs',
  industrial_crops: 'Industrial crops',
  paddy: 'Paddy',
  spices: 'Spices',
  vegetables: 'Vegetables',
}

const cropLabel = (c: string) => CROP_LABEL[c] ?? tidy(c.replace(/_/g, ' '))

const COAST_LABEL: Record<string, string> = {
  west: 'West coast, Peninsular Malaysia',
  east: 'East coast, Peninsular Malaysia',
  borneo: 'Sabah, Sarawak & Labuan',
  all: 'All coasts',
}

const monthName = (iso: string) =>
  new Date(iso).toLocaleDateString('en-MY', { month: 'long', year: 'numeric' })

export function FarmsPanel({ crops, items, meta }: { crops: CropsData; items: Item[]; meta: Meta }) {
  const [measure, setMeasure] = useState<Measure>('production')
  const [crop, setCrop] = useState('all')

  const years = useMemo(
    () => [...new Set(crops.state.map((r) => r.date))].sort(),
    [crops.state],
  )
  const latestYear = years[years.length - 1]

  const cropTypes = useMemo(
    () => [...new Set(crops.state.map((r) => r.crop_type))].sort((a, b) => cropLabel(a).localeCompare(cropLabel(b))),
    [crops.state],
  )

  const nationalLatest = useMemo(
    () => crops.state.filter((r) => r.state === 'Malaysia' && r.date === latestYear),
    [crops.state, latestYear],
  )

  const totals = useMemo(() => {
    const rows = crop === 'all' ? nationalLatest : nationalLatest.filter((r) => r.crop_type === crop)
    // Flowers are counted in stems, not tonnes, so they are excluded from the tonnage total.
    const tonnage = rows.filter((r) => r.crop_type !== 'flower').reduce((s, r) => s + r.production, 0)
    const area = rows.reduce((s, r) => s + r.planted_area, 0)
    return { tonnage, area }
  }, [nationalLatest, crop])

  const byState = useMemo(() => {
    const rows = crops.state.filter(
      (r) => r.date === latestYear && r.state !== 'Malaysia' && (crop === 'all' ? r.crop_type !== 'flower' : r.crop_type === crop),
    )
    const agg = new Map<string, number>()
    for (const r of rows) agg.set(r.state, (agg.get(r.state) ?? 0) + (measure === 'production' ? r.production : r.planted_area))
    return [...agg.entries()]
      .map(([label, value]) => ({ label, value }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
  }, [crops.state, latestYear, crop, measure])

  const byCrop = useMemo(() => {
    const rows = nationalLatest.filter((r) => r.crop_type !== 'flower')
    return rows
      .map((r) => ({ label: cropLabel(r.crop_type), value: measure === 'production' ? r.production : r.planted_area }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
  }, [nationalLatest, measure])

  // The district tables are published for a different, older year than the state table,
  // so they need their own latest year rather than the state one.
  const districtYear = useMemo(() => {
    const dates = [...new Set(crops.districtProduction.map((r) => r.date))].sort()
    return dates[dates.length - 1] ?? null
  }, [crops.districtProduction])

  const topSpecies = useMemo(() => {
    if (!districtYear) return []
    const agg = new Map<string, number>()
    for (const r of crops.districtProduction) {
      if (r.date !== districtYear) continue
      const v = r.production ?? 0
      if (v > 0) agg.set(r.crop_species, (agg.get(r.crop_species) ?? 0) + v)
    }
    return [...agg.entries()]
      .map(([label, value]) => ({ label: tidy(label.replace(/_/g, ' ')), value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 15)
  }, [crops.districtProduction, districtYear])

  // Marine fish landings, most recent full calendar year available.
  const fish = useMemo(() => {
    const rows = crops.fishLandings ?? []
    if (!rows.length) return null
    const national = rows.filter((r) => r.state === 'Malaysia' && r.coast === 'all')
    const latestMonth = national.reduce((m, r) => (r.date > m ? r.date : m), national[0]?.date ?? '')
    const year = latestMonth.slice(0, 4)
    const monthly = national
      .filter((r) => r.date.startsWith(year))
      .sort((a, b) => a.date.localeCompare(b.date))
    const total = monthly.reduce((s, r) => s + r.landings, 0)
    // Individual states are tagged with the coast they land on (west, east or borneo),
    // never "all"; only the two roll-up rows use that. Johor has both coasts, so sum.
    const byState = new Map<string, number>()
    const byCoast = new Map<string, number>()
    for (const r of rows) {
      if (!r.date.startsWith(year)) continue
      if (r.state === 'Malaysia' || r.state === 'All States') continue
      byState.set(r.state, (byState.get(r.state) ?? 0) + r.landings)
      byCoast.set(r.coast, (byCoast.get(r.coast) ?? 0) + r.landings)
    }
    return {
      year,
      total,
      monthly,
      byState: [...byState.entries()]
        .map(([label, value]) => ({ label, value }))
        .filter((r) => r.value > 0)
        .sort((a, b) => b.value - a.value),
      byCoast: [...byCoast.entries()]
        .map(([label, value]) => ({ label: COAST_LABEL[label] ?? tidy(label), value }))
        .filter((r) => r.value > 0)
        .sort((a, b) => b.value - a.value),
    }
  }, [crops.fishLandings])

  const surveyStates = useMemo(() => {
    const agg = new Map<string, number>()
    for (const i of items) for (const [s, n] of Object.entries(i.activeByState)) agg.set(s, Math.max(agg.get(s) ?? 0, n))
    return [...agg.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
  }, [items])

  const measureLabel = measure === 'production' ? 'Production (tonnes)' : 'Planted area (hectares)'
  const fmt = (v: number) =>
    v >= 1_000_000 ? `${decimal(v / 1_000_000)}M` : v >= 1_000 ? `${decimal(v / 1_000)}k` : decimal(v)

  if (!years.length) return <Empty>Crop statistics are missing. Run the data build script.</Empty>

  return (
    <>
      <Panel
        title={`Malaysian crop output, ${new Date(latestYear).getFullYear()}`}
        note="Department of Statistics Malaysia agriculture census, the most recent year published."
        actions={
          <div className="filters">
            <label className="field">
              <span className="sr-only">Crop type</span>
              <select value={crop} onChange={(e) => setCrop(e.target.value)}>
                <option value="all">All crop types</option>
                {cropTypes.map((c) => (
                  <option key={c} value={c}>
                    {cropLabel(c)}
                  </option>
                ))}
              </select>
            </label>
            <SegmentedControl
              label="Measure"
              value={measure}
              onChange={setMeasure}
              options={[
                { value: 'production', label: 'Production' },
                { value: 'planted_area', label: 'Planted area' },
              ]}
            />
          </div>
        }
      >
        <div className="tiles">
          <StatTile label="Production" value={`${fmt(totals.tonnage)} t`} sub={crop === 'all' ? 'all crops except flowers' : cropLabel(crop)} tone="hero" />
          <StatTile label="Planted area" value={`${fmt(totals.area)} ha`} sub="same selection" />
          <StatTile
            label="Average yield"
            value={totals.area ? `${decimal(totals.tonnage / totals.area)} t/ha` : '—'}
            sub="production over planted area"
          />
          <StatTile label="Years covered" value={`${new Date(years[0]).getFullYear()}–${new Date(latestYear).getFullYear()}`} sub={`${years.length} annual releases`} />
        </div>

        <h3 className="sub-head">{measureLabel} by state</h3>
        <RankBars rows={byState} format={fmt} />
        <p className="disclaimer">
          Flowers are recorded in stems rather than tonnes, so they are left out of the all-crops
          totals and the state ranking.
        </p>
      </Panel>

      <Panel title={`${measureLabel} by crop type`} note="National totals for the same year.">
        <RankBars rows={byCrop} format={fmt} />
      </Panel>

      <Panel
        title="Largest crops by species"
        note={
          districtYear
            ? `Aggregated from the district production tables, which are published only for ${new Date(districtYear).getFullYear()}. This is the only place durian, rambutan and other named fruit appear.`
            : 'District production tables are not available.'
        }
      >
        {topSpecies.length ? (
          <RankBars rows={topSpecies} format={(v) => `${fmt(v)} t`} />
        ) : (
          <Empty>No district-level production data in this snapshot.</Empty>
        )}
      </Panel>

      {fish ? (
        <Panel
          title={`Marine fish landings, ${fish.year}`}
          note="What Malaysian fishing boats actually brought ashore. Landings are volume, not price."
        >
          <div className="tiles">
            <StatTile label="Total landed" value={`${fmt(fish.total)} t`} sub={`${fish.monthly.length} months reported`} tone="hero" />
            <StatTile
              label="Best month"
              value={`${fmt(Math.max(...fish.monthly.map((m) => m.landings)))} t`}
              sub={monthName(fish.monthly.reduce((a, b) => (b.landings > a.landings ? b : a)).date)}
            />
            <StatTile
              label="Leanest month"
              value={`${fmt(Math.min(...fish.monthly.map((m) => m.landings)))} t`}
              sub={monthName(fish.monthly.reduce((a, b) => (b.landings < a.landings ? b : a)).date)}
            />
            <StatTile label="States landing fish" value={String(fish.byState.length)} />
          </div>
          <h3 className="sub-head">Landings by coast (tonnes)</h3>
          <RankBars rows={fish.byCoast} format={(v) => `${fmt(v)} t`} />
          <h3 className="sub-head">Landings by state (tonnes)</h3>
          <RankBars rows={fish.byState} format={(v) => `${fmt(v)} t`} />
          <p className="disclaimer">
            Marine landings only. Aquaculture and freshwater catch are not in this table, and the
            series ends where the Department of Statistics stopped publishing it.
          </p>
        </Panel>
      ) : null}

      <Panel
        title="Price survey coverage"
        note="Where prices actually come from. Each premise is a shop, market stall or supermarket visited by KPDN enumerators."
      >
        <div className="tiles">
          <StatTile label="Premises in the register" value={count(meta.premises)} tone="hero" />
          <StatTile label="Items tracked here" value={count(meta.items)} sub="crops, livestock and seafood" />
          <StatTile label="Price records scanned" value={count(meta.rowsScanned)} sub={`${meta.months.length} months`} />
          <StatTile label="States and territories" value={String(surveyStates.length)} />
        </div>
        <h3 className="sub-head">Reporting premises by state</h3>
        <RankBars rows={surveyStates} format={(v) => count(v)} />
      </Panel>
    </>
  )
}
