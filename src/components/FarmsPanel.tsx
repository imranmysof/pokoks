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

  const topSpecies = useMemo(() => {
    const rows = crops.districtProduction.filter((r) => r.date === latestYear)
    const agg = new Map<string, number>()
    for (const r of rows) {
      const v = r.production ?? 0
      if (v > 0) agg.set(r.crop_species, (agg.get(r.crop_species) ?? 0) + v)
    }
    return [...agg.entries()]
      .map(([label, value]) => ({ label: tidy(label.replace(/_/g, ' ')), value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 12)
  }, [crops.districtProduction, latestYear])

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

      <Panel title="Largest crops by species" note="Aggregated from the district-level production tables.">
        <RankBars rows={topSpecies} format={(v) => `${fmt(v)} t`} />
      </Panel>

      <Panel
        title="Price survey coverage"
        note="Where prices actually come from. Each premise is a shop, market stall or supermarket visited by KPDN enumerators."
      >
        <div className="tiles">
          <StatTile label="Premises in the register" value={count(meta.premises)} tone="hero" />
          <StatTile label="Items tracked here" value={count(meta.items)} sub="agriculture and horticulture only" />
          <StatTile label="Price records scanned" value={count(meta.rowsScanned)} sub={`${meta.months.length} months`} />
          <StatTile label="States and territories" value={String(surveyStates.length)} />
        </div>
        <h3 className="sub-head">Reporting premises by state</h3>
        <RankBars rows={surveyStates} format={(v) => count(v)} />
      </Panel>
    </>
  )
}
