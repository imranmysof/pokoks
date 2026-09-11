import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { loadCrops, loadItems, loadMeta, loadPalm } from './lib/data'
import type { CropsData, Item, Meta, PalmData } from './lib/types'
import { longDate } from './lib/format'
import { PalmPanel } from './components/PalmPanel'
import { PricesPanel } from './components/PricesPanel'
import { FarmsPanel } from './components/FarmsPanel'
import { VenturePanel } from './components/VenturePanel'
import { ItemDetail } from './components/ItemDetail'
import { Empty, Panel } from './components/Primitives'

type Tab = 'palm' | 'prices' | 'farms' | 'venture' | 'about'

const TABS: { value: Tab; label: string }[] = [
  { value: 'palm', label: 'Sawit' },
  { value: 'prices', label: 'Harga' },
  { value: 'farms', label: 'Ladang' },
  { value: 'venture', label: 'Usaha' },
  { value: 'about', label: 'Sumber' },
]

type Theme = 'light' | 'dark' | 'system'

function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem('pokoks-theme') as Theme) || 'system'
    } catch {
      return 'system'
    }
  })
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
    try {
      localStorage.setItem('pokoks-theme', theme)
    } catch {
      /* private browsing */
    }
  }, [theme])
  return [theme, setTheme]
}

export default function App() {
  const [tab, setTab] = useState<Tab>('palm')
  const [items, setItems] = useState<Item[] | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [palm, setPalm] = useState<PalmData | null>(null)
  const [crops, setCrops] = useState<CropsData | null>(null)
  const [selected, setSelected] = useState<Item | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [theme, setTheme] = useTheme()

  useEffect(() => {
    Promise.all([loadItems(), loadMeta()])
      .then(([i, m]) => {
        setItems(i)
        setMeta(m)
      })
      .catch((e: Error) => setError(e.message))
    loadPalm()
      .then(setPalm)
      .catch(() => setPalm(null))
    loadCrops()
      .then(setCrops)
      .catch(() => setCrops(null))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelected(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const asOf = useMemo(() => {
    if (!items?.length) return null
    return items.reduce((latest, i) => (i.latest.date > latest ? i.latest.date : latest), items[0].latest.date)
  }, [items])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            🌴
          </span>
          <div>
            <h1>Pokoks</h1>
            <p>Malaysian farm, livestock and sea prices, from official open data</p>
          </div>
        </div>
        <div className="topbar-right">
          {asOf ? <span className="asof">Prices as of {longDate(asOf)}</span> : null}
          <label className="field theme-field">
            <span className="sr-only">Colour theme</span>
            <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
              <option value="system">System theme</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </div>
      </header>

      <nav className="tabs" aria-label="Sections">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            className={t.value === tab ? 'tab tab-on' : 'tab'}
            aria-current={t.value === tab ? 'page' : undefined}
            onClick={() => {
              setTab(t.value)
              setSelected(null)
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="main">
        {error ? (
          <Panel title="No data yet">
            <Empty>{error}</Empty>
            <pre className="code">npm run data</pre>
          </Panel>
        ) : null}

        {!error && !items ? <Empty>Loading price data…</Empty> : null}

        {selected ? (
          <ItemDetail key={selected.code} item={selected} onClose={() => setSelected(null)} />
        ) : (
          <>
            {tab === 'palm' && items ? (
              palm && palm.series.length ? (
                <PalmPanel palm={palm} items={items} />
              ) : (
                <Panel title="Palm prices not fetched">
                  <Empty>Run the palm fetcher to pull the latest crude palm oil prices from MPOB.</Empty>
                  <pre className="code">npm run data:palm</pre>
                </Panel>
              )
            ) : null}

            {tab === 'prices' && items ? <PricesPanel items={items} onSelect={setSelected} /> : null}

            {tab === 'farms' && items && meta ? (
              crops ? (
                <FarmsPanel crops={crops} items={items} meta={meta} />
              ) : (
                <Panel title="Crop statistics not built">
                  <Empty>Run the data build to download the DOSM agriculture tables.</Empty>
                  <pre className="code">npm run data</pre>
                </Panel>
              )
            ) : null}

            {tab === 'venture' && items ? <VenturePanel items={items} crops={crops} /> : null}

            {tab === 'about' && meta ? <About meta={meta} palm={palm} /> : null}
          </>
        )}
      </main>

      <footer className="footer">
        <p>
          Built on open data from the Department of Statistics Malaysia and the Malaysian Palm Oil
          Board. Figures are indicative, not a substitute for a firm quotation from your mill,
          wholesaler or buyer.
        </p>
      </footer>
    </div>
  )
}

function About({ meta, palm }: { meta: Meta; palm: PalmData | null }) {
  const premiseTypes = Object.entries(meta.premiseTypes)
    .filter(([k]) => k !== 'unknown')
    .sort((a, b) => b[1] - a[1])

  return (
    <>
      <Panel title="Where the numbers come from" note={`Data snapshot built ${longDate(meta.builtAt)}.`}>
        <ul className="sources">
          {meta.sources.map((s) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.name}
              </a>
              <span className="muted"> · {s.licence}</span>
            </li>
          ))}
          {palm ? (
            <li>
              <a href={palm.source.url} target="_blank" rel="noreferrer">
                {palm.source.name}
              </a>
              <span className="muted"> · daily crude palm oil price, {palm.range} window</span>
            </li>
          ) : null}
        </ul>
      </Panel>

      <Panel title="What the survey actually covers">
        <div className="table-scroll">
          <table className="data-table">
            <caption className="sr-only">Premises in the PriceCatcher register by type</caption>
            <thead>
              <tr>
                <th scope="col">Premise type</th>
                <th scope="col">Count</th>
                <th scope="col">Treated as</th>
              </tr>
            </thead>
            <tbody>
              {premiseTypes.map(([type, n]) => (
                <tr key={type}>
                  <th scope="row">{type}</th>
                  <td className="tnum">{n}</td>
                  <td className="muted">
                    {type === 'Borong'
                      ? 'Wholesale'
                      : type.startsWith('Pasar Basah')
                        ? 'Wet market'
                        : ['Pasar Raya / Supermarket', 'Hypermarket', 'Kedai Runcit', 'Pasar Mini', 'Kedai Serbaneka'].includes(type)
                          ? 'Retail'
                          : 'Excluded, prepared food'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Known limits">
        <ul className="limits">
          <li>
            <strong>No true wholesale prices.</strong> Only fifteen wholesale premises are registered
            and none of them reported any of the crops tracked here, so the wet market average stands
            in for a farmgate reference.
          </li>
          <li>
            <strong>Palm fresh fruit bunch prices are derived.</strong> The official reference price is
            published by MPOB in a form that cannot be read automatically, so this app multiplies the
            crude palm oil price by an oil extraction rate
            {palm ? ` of ${(palm.ffb.oer * 100).toFixed(1)}%` : ''} and a grower share
            {palm ? ` of ${(palm.ffb.millingShare * 100).toFixed(0)}%` : ''}. Check it against your own
            mill statement before relying on it.
          </li>
          <li>
            <strong>Durian has no price, only production.</strong> PriceCatcher surveys eighteen
            fruits and durian is not among them, nor are rambutan, mangosteen or langsat. They
            appear only as tonnages in the district crop tables, under largest crops by species.
            For durian prices you would need FAMA or a state agriculture department, neither of
            which publishes a machine-readable feed.
          </li>
          <li>
            <strong>Livestock is priced as meat, not as animals.</strong> The survey covers chicken,
            beef, buffalo, mutton and pork at the counter. Live animals appear only as live chicken
            and a live pig carcass weight, so there is no cattle or goat auction price here.
          </li>
          <li>
            <strong>Crop statistics lag prices by years.</strong> Prices are daily. The state crop
            census is annual and ends at 2022, the district tables only cover 2017, and marine fish
            landings stop in 2023.
          </li>
          <li>
            <strong>Forecasts extrapolate, they do not explain.</strong> The model sees only past
            prices. Weather, export duty, festival demand and world vegetable oil markets are all
            outside it.
          </li>
          <li>
            <strong>Some items are price-controlled.</strong> Subsidised cooking oil and festive-season
            ceiling prices will not move like a free market.
          </li>
        </ul>
      </Panel>

      <Panel title="Refreshing the data">
        <p className="prose">
          Both datasets are static JSON files under <code>public/data</code>, regenerated by scripts
          rather than fetched at page load, so the app stays fast and works offline once built.
        </p>
        <pre className="code">{'npm run data        # PriceCatcher + DOSM crop tables\nnpm run data:palm   # MPOB daily palm oil prices\nnpm run data:all    # both'}</pre>
      </Panel>
    </>
  )
}
