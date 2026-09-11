import { useMemo, useState } from 'react'
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { CropsData, Item } from '../lib/types'
import { computeVenture, type VentureInputs } from '../lib/venture'
import { PRESETS, SPECIES_TO_ITEM, type VenturePreset } from '../lib/ventures'
import { count, decimal, money, tidy } from '../lib/format'
import { Empty, Panel, SegmentedControl, StatTile } from './Primitives'

/**
 * Rough cost of growing a kilogram of vegetables or fruit, excluding harvest and haulage,
 * which are modelled separately. Used only to seed the generic crop preset, where a single
 * per-hectare figure would be absurd across crops whose yields differ tenfold. Like every
 * cost here it is a starting guess, and the field is editable.
 */
const GROWING_COST_PER_KG = 2

/**
 * Rough setup cost per kilogram of annual capacity for the generic crop preset. A block
 * yielding ninety tonnes a hectare is under fertigation or cover and costs accordingly;
 * a leafy green on open ground does not. Scaling beats a single flat figure, but this is
 * still a guess and still editable.
 */
const CAPEX_PER_KG_CAPACITY = 2

/** Above this yearly return on capital, the cost assumptions are almost certainly wrong. */
const IMPLAUSIBLE_RETURN_PCT = 150

/** Measured yield per hectare, in kg, from the DOSM district tables. */
interface YieldFacts {
  nationalKgPerHa: number
  byState: { state: string; kgPerHa: number; hectares: number }[]
  year: number
}

function deriveYield(crops: CropsData, species: string): YieldFacts | null {
  const prod = crops.districtProduction.filter((r) => r.crop_species === species)
  const area = crops.districtArea.filter((r) => r.crop_species === species)
  if (!prod.length || !area.length) return null

  const year = new Date(prod[0].date).getFullYear()
  const pByState = new Map<string, number>()
  const aByState = new Map<string, number>()
  for (const r of prod) pByState.set(r.state, (pByState.get(r.state) ?? 0) + (r.production ?? 0))
  for (const r of area) aByState.set(r.state, (aByState.get(r.state) ?? 0) + (r.planted_area ?? 0))

  let totalP = 0
  let totalA = 0
  const byState: YieldFacts['byState'] = []
  for (const [state, a] of aByState) {
    const p = pByState.get(state) ?? 0
    totalP += p
    totalA += a
    // A district with a few planted hectares and no recorded harvest yields a meaningless
    // ratio, so require a real block before reporting a per-state figure.
    if (a >= 20 && p > 0) byState.push({ state, kgPerHa: (p / a) * 1000, hectares: a })
  }
  if (!totalA) return null
  byState.sort((x, y) => y.kgPerHa - x.kgPerHa)
  return { nationalKgPerHa: (totalP / totalA) * 1000, byState, year }
}

/** A labelled number input that keeps its own text state so it can be cleared while typing. */
function Field({
  label, value, onChange, suffix, note, step = 1, min = 0, emphasis,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  suffix?: string
  note?: string
  step?: number
  min?: number
  emphasis?: 'measured' | 'assumed' | 'manual'
}) {
  // The input keeps raw text so it can be emptied mid-edit. When the value changes from
  // outside (picking a different state refills the yield), adjust during render rather
  // than in an effect, which is React's documented pattern and avoids a second pass.
  const [text, setText] = useState(String(value))
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    setText(String(value))
  }
  return (
    <label className={`vfield${emphasis ? ` vfield-${emphasis}` : ''}`}>
      <span className="vfield-label">
        {label}
        {emphasis === 'measured' ? <em className="tag tag-measured">measured</em> : null}
        {emphasis === 'manual' ? <em className="tag tag-manual">you must supply</em> : null}
      </span>
      <span className="vfield-input">
        <input
          type="number"
          value={text}
          step={step}
          min={min}
          onChange={(e) => {
            setText(e.target.value)
            const n = Number(e.target.value)
            if (e.target.value !== '' && Number.isFinite(n) && n >= min) onChange(n)
          }}
        />
        {suffix ? <span className="vfield-suffix">{suffix}</span> : null}
      </span>
      {note ? <span className="vfield-note">{note}</span> : null}
    </label>
  )
}

export function VenturePanel({ items, crops }: { items: Item[]; crops: CropsData | null }) {
  const [presetId, setPresetId] = useState(PRESETS[0].id)
  const [cropSpecies, setCropSpecies] = useState(SPECIES_TO_ITEM[0].species)
  const preset = PRESETS.find((p) => p.id === presetId) as VenturePreset

  // Keying the form on the venture and crop remounts it with that preset's defaults.
  // A pond's costs must never carry over into an orchard, and a remount is a cleaner
  // way to guarantee that than resetting field by field.
  return (
    <VentureForm
      key={`${presetId}:${cropSpecies}`}
      items={items}
      crops={crops}
      preset={preset}
      presetId={presetId}
      onPreset={setPresetId}
      cropSpecies={cropSpecies}
      onCropSpecies={setCropSpecies}
    />
  )
}

function VentureForm({
  items, crops, preset, presetId, onPreset, cropSpecies, onCropSpecies,
}: {
  items: Item[]
  crops: CropsData | null
  preset: VenturePreset
  presetId: string
  onPreset: (id: string) => void
  cropSpecies: string
  onCropSpecies: (s: string) => void
}) {
  const [state, setState] = useState('__national__')

  const activeSpeciesForSeed = preset.id === 'crop' ? cropSpecies : preset.species
  const yields = useMemo(
    () => (crops && activeSpeciesForSeed ? deriveYield(crops, activeSpeciesForSeed) : null),
    [crops, activeSpeciesForSeed],
  )

  // A flat cost per hectare cannot describe both kangkung at 10 t/ha and tomato at 94.
  // Growing cost per kilogram is far steadier across crops, so the generic preset seeds
  // its operating cost from the measured yield instead of a fixed number.
  const seeded = useMemo(() => {
    const d = preset.defaults
    if (preset.id !== 'crop' || !yields) return d
    const kg = Math.round(yields.nationalKgPerHa)
    return {
      ...d,
      yieldPerUnit: kg,
      opexPerUnit: Math.round(kg * GROWING_COST_PER_KG),
      capexPerUnit: Math.round(kg * CAPEX_PER_KG_CAPACITY),
    }
  }, [preset, yields])

  const [inputs, setInputs] = useState<Omit<VentureInputs, 'kind' | 'marketPrice'>>(seeded)
  const [manualPrice, setManualPrice] = useState(preset.manualPriceDefault ?? 0)
  // Null means "follow the measured yield for the chosen state". Typing in the yield box
  // takes manual control, and from then on changing state no longer overwrites the entry.
  const [yieldOverride, setYieldOverride] = useState<number | null>(null)

  const byCode = useMemo(() => new Map(items.map((i) => [i.code, i])), [items])

  // Which crop the venture actually sells, and therefore which price and yield apply.
  const activeItem = useMemo(() => {
    if (preset.itemCode) return byCode.get(preset.itemCode) ?? null
    if (preset.id === 'crop') {
      const pair = SPECIES_TO_ITEM.find((s) => s.species === cropSpecies)
      return pair ? (byCode.get(pair.itemCode) ?? null) : null
    }
    return null
  }, [preset, cropSpecies, byCode])

  // Measured yield for the chosen state, used unless the operator has typed their own.
  const measuredYield = useMemo(() => {
    if (!yields) return null
    const picked =
      state === '__national__'
        ? yields.nationalKgPerHa
        : (yields.byState.find((s) => s.state === state)?.kgPerHa ?? yields.nationalKgPerHa)
    return Math.round(picked)
  }, [yields, state])

  const effectiveInputs = useMemo(
    () => ({ ...inputs, yieldPerUnit: yieldOverride ?? measuredYield ?? inputs.yieldPerUnit }),
    [inputs, yieldOverride, measuredYield],
  )

  const marketPrice = preset.priceIsManual ? manualPrice : (activeItem?.latest.avg ?? 0)

  const result = useMemo(
    () => computeVenture({ ...effectiveInputs, kind: preset.kind, marketPrice }),
    [effectiveInputs, preset.kind, marketPrice],
  )

  const set = <K extends keyof typeof inputs>(k: K, v: (typeof inputs)[K]) =>
    setInputs((prev) => ({ ...prev, [k]: v }))

  const unitWord = inputs.scale === 1 ? preset.unit : preset.unitPlural
  const perYearWord = preset.kind === 'aquaculture' ? 'per cycle' : 'per year'

  const chartRows = result.years.map((y) => ({
    year: `Y${y.year}`,
    net: Math.round(y.net),
    cumulative: Math.round(y.cumulative),
  }))

  // How the mature-year profit responds to the price moving, since price is the single
  // input a grower controls least and worries about most.
  const sensitivity = useMemo(() => {
    return [-30, -15, 0, 15, 30].map((pct) => {
      const p = marketPrice * (1 + pct / 100)
      const r = computeVenture({ ...effectiveInputs, kind: preset.kind, marketPrice: p })
      return { pct, price: p, profit: r.steadyProfit }
    })
  }, [effectiveInputs, preset.kind, marketPrice])

  const priceKnown = marketPrice > 0
  const viable = result.steadyProfit > 0
  // A headline return this high means the assumptions are wrong, not that the reader has
  // found a miracle. Say so rather than letting the tile stand on its own.
  const implausible = (result.returnOnCapital ?? 0) > IMPLAUSIBLE_RETURN_PCT

  // Say plainly which inputs are observations rather than guesses. It differs by venture:
  // a pond has a surveyed price but no published yield, and durian is the reverse.
  const measuredLabel = [
    !preset.priceIsManual && activeItem ? 'the market price' : null,
    yields ? 'the yield per hectare' : null,
  ]
    .filter(Boolean)
    .join(' and ')

  return (
    <>
      <Panel
        title="Start a venture"
        note="A feasibility sketch built on the same data as the rest of this app. Measured figures are marked; everything else is an assumption you should replace with your own quotes."
        actions={
          <SegmentedControl
            label="Venture"
            value={presetId}
            onChange={onPreset}
            options={PRESETS.map((p) => ({ value: p.id, label: p.label }))}
          />
        }
      >
        <p className="venture-blurb">{preset.blurb}</p>

        <div className="filters venture-pickers">
          {preset.id === 'crop' ? (
            <label className="field">
              <span className="sr-only">Crop</span>
              <select value={cropSpecies} onChange={(e) => onCropSpecies(e.target.value)}>
                {SPECIES_TO_ITEM.map((s) => (
                  <option key={s.species} value={s.species}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {yields && yields.byState.length ? (
            <label className="field">
              <span className="sr-only">Yield basis</span>
              <select value={state} onChange={(e) => setState(e.target.value)}>
                <option value="__national__">
                  National yield ({decimal(yields.nationalKgPerHa / 1000)} t/ha)
                </option>
                {yields.byState.map((s) => (
                  <option key={s.state} value={s.state}>
                    {s.state} ({decimal(s.kgPerHa / 1000)} t/ha)
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        {implausible ? (
          <p className="notice notice-warn">
            These numbers do not hang together. A return of{' '}
            {decimal(result.returnOnCapital ?? 0)}% a year on capital is not something farming
            does, so the cost assumptions almost certainly do not match a yield of{' '}
            {decimal(effectiveInputs.yieldPerUnit / 1000)} tonnes per {preset.unit}. A crop that
            productive needs far more capital, fertiliser and labour than the defaults here
            assume. Put your own costs in before reading anything into the result.
          </p>
        ) : null}

        {preset.priceIsManual ? (
          <p className="notice">
            Durian is not in the PriceCatcher survey, so this app has no durian price to give
            you. The figure below is a placeholder, not data. Prices swing enormously by
            variety and season, so put in a farm gate price your own buyer has quoted.
          </p>
        ) : null}

        {!priceKnown ? (
          <Empty>No market price available for this selection.</Empty>
        ) : (
          <div className="tiles">
            <StatTile
              label="Startup capital"
              value={money(result.startupCapital)}
              sub={`${count(inputs.scale)} ${unitWord}`}
              tone="hero"
            />
            <StatTile
              label="First income"
              value={
                result.firstIncomeYear === null
                  ? 'beyond horizon'
                  : result.firstIncomeYear === 0
                    ? 'first year'
                    : `year ${result.firstIncomeYear}`
              }
              sub={preset.kind === 'orchard' ? 'nothing to sell until then' : 'from first harvest'}
            />
            <StatTile
              label="Profit once mature"
              value={`${money(result.steadyProfit)}/yr`}
              sub={`${money(result.steadyRevenue)} in, ${money(result.steadyOperating)} out`}
            />
            <StatTile
              label="Money back in"
              value={result.paybackYear === null ? 'not within horizon' : `year ${result.paybackYear}`}
              sub={
                result.returnOnCapital != null && viable
                  ? `${decimal(result.returnOnCapital)}% a year on capital`
                  : 'cumulative cash stays negative'
              }
            />
          </div>
        )}

        {priceKnown ? (
          <div className={`callout${viable ? '' : ' callout-warn'}`}>
            <p>
              {viable ? (
                <>
                  You need <strong>{money(result.breakEvenPrice)} per kg</strong> at the farm gate
                  just to cover costs, and the model assumes you get{' '}
                  <strong>{money(result.farmgatePrice)}</strong>.
                  {preset.priceIsManual
                    ? ' That margin rests entirely on the price you entered above.'
                    : ` That works out to ${money(result.breakEvenMarketPrice)} at market, against ${money(marketPrice)} surveyed today.`}
                </>
              ) : (
                <>
                  This does not pay at these numbers. Covering costs needs{' '}
                  <strong>{money(result.breakEvenPrice)} per kg</strong> at the farm gate, but the
                  model only gives you {money(result.farmgatePrice)}. Raise the yield, cut the
                  operating cost, or find a buyer who pays more.
                </>
              )}
            </p>
          </div>
        ) : null}
      </Panel>

      <Panel
        title="Cash position, year by year"
        note="Bars are each year on its own. The line is money in the bank since you started, so the business has paid for itself where it crosses zero."
      >
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={chartRows} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="year" stroke="var(--text-muted)" fontSize={11} tickLine={false} />
            <YAxis
              stroke="var(--text-muted)"
              fontSize={11}
              tickLine={false}
              width={70}
              tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--surface-1)',
                border: '1px solid var(--border-strong)',
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value, name) => [
                money(typeof value === 'number' ? value : Number(value)),
                name === 'net' ? 'That year' : 'Cumulative',
              ]}
            />
            <ReferenceLine y={0} stroke="var(--border-strong)" />
            <Bar dataKey="net" name="net" radius={[3, 3, 0, 0]}>
              {chartRows.map((r) => (
                <Cell key={r.year} fill={r.net >= 0 ? 'var(--good)' : 'var(--critical)'} />
              ))}
            </Bar>
            <Line
              type="monotone"
              dataKey="cumulative"
              name="cumulative"
              stroke="var(--series-1)"
              strokeWidth={2}
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </Panel>

      <Panel
        title="What you control"
        note="Change anything here. Only the marked fields come from the data; the rest are starting guesses."
      >
        <div className="vgrid">
          <Field
            label="Scale"
            value={inputs.scale}
            onChange={(v) => set('scale', v)}
            suffix={preset.unitPlural}
            step={1}
            min={1}
          />
          {preset.priceIsManual ? (
            <Field
              label="Farm gate price"
              value={manualPrice}
              onChange={setManualPrice}
              suffix="RM/kg"
              step={0.5}
              emphasis="manual"
              note="No survey covers durian. This must come from your buyer."
            />
          ) : (
            <Field
              label="Market price"
              value={Math.round((activeItem?.latest.avg ?? 0) * 100) / 100}
              onChange={() => {}}
              suffix="RM/kg"
              emphasis="measured"
              note={
                activeItem
                  ? `${tidy(activeItem.name)}, averaged across ${count(activeItem.latest.n)} premises`
                  : undefined
              }
            />
          )}
          {!preset.priceIsManual ? (
            <Field
              label="Share reaching the farm"
              value={Math.round(inputs.farmgateShare * 100)}
              onChange={(v) => set('farmgateShare', v / 100)}
              suffix="%"
              step={5}
              note={preset.notes.farmgateShare}
            />
          ) : null}
          <Field
            label={preset.kind === 'aquaculture' ? 'Harvest per pond' : 'Yield per hectare'}
            value={effectiveInputs.yieldPerUnit}
            onChange={setYieldOverride}
            suffix={`kg ${perYearWord}`}
            step={50}
            emphasis={yields ? 'measured' : undefined}
            note={preset.notes.yieldPerUnit}
          />
          <Field
            label="Harvests a year"
            value={inputs.cyclesPerYear}
            onChange={(v) => set('cyclesPerYear', v)}
            suffix="per year"
            step={1}
            min={1}
            note={preset.notes.cyclesPerYear}
          />
          <Field
            label="Setup cost"
            value={inputs.capexPerUnit}
            onChange={(v) => set('capexPerUnit', v)}
            suffix={`RM per ${preset.unit}`}
            step={500}
            note={preset.notes.capexPerUnit}
          />
          <Field
            label="Running cost"
            value={inputs.opexPerUnit}
            onChange={(v) => set('opexPerUnit', v)}
            suffix={`RM ${perYearWord}`}
            step={500}
            note={preset.notes.opexPerUnit}
          />
          <Field
            label="Harvest and haulage"
            value={inputs.harvestCostPerKg}
            onChange={(v) => set('harvestCostPerKg', v)}
            suffix="RM/kg"
            step={0.1}
            note="Picking, grading and getting it to the buyer. Scales with what you actually harvest."
          />
          {preset.kind === 'orchard' ? (
            <>
              <Field
                label="Years before first fruit"
                value={inputs.gestationYears}
                onChange={(v) => set('gestationYears', v)}
                suffix="years"
                step={1}
                note={preset.notes.gestationYears}
              />
              <Field
                label="Years to full yield"
                value={inputs.maturityYears}
                onChange={(v) => set('maturityYears', v)}
                suffix="years"
                step={1}
                note={preset.notes.maturityYears}
              />
              <Field
                label="Upkeep while waiting"
                value={inputs.upkeepBeforeHarvest}
                onChange={(v) => set('upkeepBeforeHarvest', v)}
                suffix={`RM per ${preset.unit}/yr`}
                step={500}
                note={preset.notes.upkeepBeforeHarvest}
              />
            </>
          ) : null}
          <Field
            label="Plan over"
            value={inputs.horizonYears}
            onChange={(v) => set('horizonYears', v)}
            suffix="years"
            step={1}
            min={1}
          />
        </div>
      </Panel>

      {priceKnown ? (
        <Panel
          title="If the price moves"
          note="Mature-year profit at other prices, with every cost held where you set it. Price is the thing you control least."
        >
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Price change</th>
                  <th scope="col">{preset.priceIsManual ? 'Farm gate' : 'Market price'}</th>
                  <th scope="col">Profit a year</th>
                  <th scope="col">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {sensitivity.map((s) => (
                  <tr key={s.pct} className={s.pct === 0 ? 'row-current' : undefined}>
                    <th scope="row">{s.pct === 0 ? 'today' : `${s.pct > 0 ? '+' : ''}${s.pct}%`}</th>
                    <td>{money(s.price)}</td>
                    <td className={s.profit >= 0 ? 'num-up' : 'num-down'}>{money(s.profit)}</td>
                    <td>{s.profit >= 0 ? 'covers its costs' : 'loses money'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}

      <Panel title="Before you rely on any of this">
        <ul className="limits">
          <li>
            <strong>
              {measuredLabel
                ? `Only ${measuredLabel} is measured here.`
                : 'Nothing here is measured.'}
            </strong>{' '}
            Every cost is a starting guess, because Malaysia publishes no machine-readable
            survey of farm costs. Replace them with real quotes before you commit money.
            {preset.id === 'tilapia'
              ? ' Pond yields in particular depend on your water, feed and stocking, none of which any published dataset covers.'
              : ''}
          </li>
          {!preset.priceIsManual ? (
            <li>
              <strong>Retail is not what you get paid.</strong> The survey records what shoppers
              pay. A grower sells to a collector or wholesaler well below that, which is what the
              farm gate share models. Ask your actual buyer.
            </li>
          ) : (
            <li>
              <strong>The price is yours, not ours.</strong> Nothing in this app knows what durian
              sells for. A premium clone and a kampung durian can differ several times over, and
              the same tree earns far less at the glut than early in the season.
            </li>
          )}
          {yields ? (
            <li>
              <strong>The yield figure is a {yields.year} average.</strong> It spans young,
              old, well run and neglected holdings alike. A serious operator should beat it,
              and a first-timer may not reach it.
            </li>
          ) : null}
          <li>
            <strong>Nothing here is financing advice.</strong> There is no loan interest, no
            land cost or rent, no insurance, and no tax. Crop failure, disease and price
            collapse are not modelled at all.
          </li>
        </ul>
      </Panel>
    </>
  )
}
