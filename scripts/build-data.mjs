// Builds compact JSON for the app from DOSM / data.gov.my open data.
// Usage: node scripts/build-data.mjs [--months 6]
import { parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const MONTHS = Number(args[args.indexOf('--months') + 1] || 6);
// A daily average taken across a handful of shops is not a market price. A day counts as
// fully surveyed only if it clears both an absolute premise floor and half of the item's
// own typical coverage.
const MIN_PREMISES_PER_DAY = 20;
const SOLID_DAY_SHARE = 0.5;

const OUT = path.resolve('public/data');
const SERIES_DIR = path.join(OUT, 'series');
const STORAGE = 'https://storage.data.gov.my/pricecatcher';
const API = 'https://api.data.gov.my';

// Farm and sea produce inside PriceCatcher (KPDN survey, published via DOSM). Everything
// here is a primary product a Malaysian grower, rearer or fisherman actually sells.
// Deliberately excluded: packaged groceries, drinks, toiletries and prepared restaurant food.
const AGRI_CATEGORIES = new Set([
  // Horticulture
  'BUAH-BUAHAN', 'SAYUR-SAYURAN', 'KELAPA', 'BAWANG', 'KACANG', 'UBI KENTANG',
  'REMPAH RATUS (TIDAK BERBUNGKUS)', 'CILI KERING', 'BERAS',
  // Livestock and poultry
  'AYAM', 'DAGING', 'TELUR',
  // Fisheries
  'BAHAN LAUT', 'IKAN DARAT', 'HASIL LAUT KERING',
]);
// Palm-based cooking oil (minyak masak tulen = 100% palm olein, sebatian = palm blend).
const isPalmOil = (it) => it.item_category === 'MINYAK DAN LEMAK' && /MINYAK MASAK/.test(it.item || '');

const fetchBuf = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.arrayBuffer();
};
const readParquet = async (url) => parquetReadObjects({ file: await fetchBuf(url), compressors });
const fetchJson = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};

const ym = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const ymd = (d) => d.toISOString().slice(0, 10);
const round = (x, p = 2) => Math.round(x * 10 ** p) / 10 ** p;
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/** Linear-interpolated percentile, q in [0,1]. */
const quantile = (a, q) => {
  const s = [...a].sort((x, y) => x - y);
  if (s.length === 1) return s[0];
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
};

/**
 * A few PriceCatcher item names carry a mangled comparison symbol, e.g.
 * "UDANG PUTIH KECIL (b\t% 61 EKOR SEKILOGRAM)". Context fixes the mapping:
 * small prawns are counted at 61 or more per kilogram (the large grade is stated as
 * 41 to 60), and "IKAN JENAHAK (b\t% 1 KILOGRAM SEEKOR)" is the large grade, so
 * "b\t%" is a broken ">=". The rarer "b\t$" appears on grades that read as an upper
 * bound, so it is "<=". Sibling items spell both symbols correctly, which is what
 * these are compared against.
 */
function cleanName(name) {
  return name
    .replace(/b\t%/g, '≥')
    .replace(/b\t\$/g, '≤')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Unit -> kg multiplier (null when not mass based).
function kgFactor(unit) {
  if (!unit) return null;
  const m = unit.toLowerCase().replace(/\s+/g, '').match(/^([\d.]+)(kg|g)$/);
  if (!m) return null;
  const q = parseFloat(m[1]);
  return m[2] === 'kg' ? q : q / 1000;
}

function channelOf(premiseType) {
  const t = (premiseType || '').trim();
  if (t === 'Borong') return 'borong';
  if (t === 'Pasar Basah') return 'pasar';
  if (['Pasar Raya / Supermarket', 'Hypermarket', 'Kedai Runcit', 'Pasar Mini', 'Kedai Serbaneka'].includes(t)) return 'runcit';
  return null;
}

async function main() {
  await mkdir(SERIES_DIR, { recursive: true });
  console.log('Loading lookups...');
  const [itemsRaw, premisesRaw] = await Promise.all([
    readParquet(`${STORAGE}/lookup_item.parquet`),
    readParquet(`${STORAGE}/lookup_premise.parquet`),
  ]);
  const items = new Map();
  for (const it of itemsRaw) {
    if (it.item_code < 0 || !it.item) continue;
    if (AGRI_CATEGORIES.has(it.item_category) || isPalmOil(it)) {
      items.set(Number(it.item_code), {
        code: Number(it.item_code), name: cleanName(it.item), unit: it.unit, group: it.item_group,
        category: it.item_category, palm: isPalmOil(it), kg: kgFactor(it.unit),
      });
    }
  }
  const premises = new Map();
  for (const p of premisesRaw) {
    if (p.premise_code < 0) continue;
    premises.set(Number(p.premise_code), {
      state: p.state, district: p.district, type: (p.premise_type || '').trim(), channel: channelOf(p.premise_type),
    });
  }
  console.log(`Tracking ${items.size} agri/horti items across ${premises.size} premises`);

  const now = new Date();
  const months = [];
  for (let i = 0; i < MONTHS; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push(ym(d));
  }

  // agg: item -> date -> { all, ch, st, prem }
  const agg = new Map();
  const bump = (item, date, price, prem) => {
    let byDate = agg.get(item);
    if (!byDate) agg.set(item, (byDate = new Map()));
    let cell = byDate.get(date);
    if (!cell) byDate.set(date, (cell = { all: [], ch: {}, st: {}, prem: new Set() }));
    cell.all.push(price);
    cell.prem.add(prem);
    const p = premises.get(prem);
    if (p) {
      if (p.channel) (cell.ch[p.channel] ||= []).push(price);
      if (p.state) (cell.st[p.state] ||= []).push(price);
    }
  };

  let totalRows = 0;
  const loaded = [];
  for (const m of months) {
    const url = `${STORAGE}/pricecatcher_${m}.parquet`;
    let rows;
    try {
      rows = await readParquet(url);
    } catch (e) {
      console.warn(`skip ${m}: ${e.message}`);
      continue;
    }
    loaded.push(m);
    for (const r of rows) {
      const code = Number(r.item_code);
      if (!items.has(code)) continue;
      const price = Number(r.price);
      if (!(price > 0)) continue;
      const date = ymd(r.date instanceof Date ? r.date : new Date(r.date));
      bump(code, date, price, Number(r.premise_code));
    }
    totalRows += rows.length;
    console.log(`${m}: ${rows.length} rows`);
  }

  const catalogue = [];
  for (const [code, byDate] of agg) {
    const it = items.get(code);
    const dates = [...byDate.keys()].sort();
    const series = dates.map((d) => {
      const c = byDate.get(d);
      const ch = {};
      for (const [k, v] of Object.entries(c.ch)) ch[k] = { avg: round(mean(v)), n: v.length };
      const st = {};
      for (const [k, v] of Object.entries(c.st)) st[k] = round(mean(v));
      return {
        d, avg: round(mean(c.all)), med: round(median(c.all)),
        // Quartiles describe where most premises actually sit. The outright min and max are
        // kept too, but a single mispriced stall makes them a poor band for a chart.
        p25: round(quantile(c.all, 0.25)), p75: round(quantile(c.all, 0.75)),
        min: round(Math.min(...c.all)), max: round(Math.max(...c.all)), n: c.prem.size, ch, st,
      };
    });
    if (series.length < 3) continue;

    // About one day in eight is a partial collection round covering a handful of premises.
    // Anchoring a percentage change on such a day produces nonsense, so headline figures use
    // only "solid" days: those with a real sample, both absolutely and relative to this item.
    const typicalN = median(series.map((s) => s.n));
    const minN = Math.max(MIN_PREMISES_PER_DAY, Math.round(typicalN * SOLID_DAY_SHARE));
    const solidDays = series.filter((s) => s.n >= minN);

    // Some items (imported meat cuts, specialty rice) are only ever seen in a few shops.
    // They stay listed, but nothing is claimed about how their price is moving.
    const sparse = solidDays.length < 3;
    const solid = sparse ? series : solidDays;

    const last = solid[solid.length - 1];
    const lastDate = new Date(last.d);
    const at = (daysAgo) => {
      const target = ymd(new Date(lastDate.getTime() - daysAgo * 86400000));
      let best = null;
      for (const s of solid) {
        if (s.d <= target) best = s;
        else break;
      }
      // Never compare against a point that is not actually about `daysAgo` old: if the
      // series starts later than that, there is nothing honest to report.
      if (!best || best === last) return null;
      const age = (lastDate.getTime() - Date.parse(best.d)) / 86400000;
      return age > daysAgo * 2 ? null : best;
    };
    const pct = (a, b) => (sparse || !a || !b ? null : round(((a.avg - b.avg) / b.avg) * 100, 1));
    const cutoff30 = ymd(new Date(lastDate.getTime() - 30 * 86400000));
    const active30 = new Set();
    for (const d of dates) if (d > cutoff30) for (const p of byDate.get(d).prem) active30.add(p);
    const activeByState = {};
    for (const p of active30) {
      const s = premises.get(p)?.state;
      if (s) activeByState[s] = (activeByState[s] || 0) + 1;
    }
    catalogue.push({
      ...it,
      latest: { date: last.d, avg: last.avg, med: last.med, min: last.min, max: last.max, n: last.n },
      borong: last.ch.borong?.avg ?? null,
      pasar: last.ch.pasar?.avg ?? null,
      runcit: last.ch.runcit?.avg ?? null,
      change7: pct(last, at(7)), change30: pct(last, at(30)), change90: pct(last, at(90)),
      spark: solid.slice(-30).map((s) => s.avg),
      activePremises: active30.size, activeByState,
      first: series[0].d, points: series.length,
      // How much of the record is usable, so the app can be honest about coverage.
      solidPoints: solidDays.length, typicalPremises: Math.round(typicalN), sparse,
    });
    // Mark partial collection days so the app can leave them out of trends and forecasts
    // while still keeping them available in the table view.
    // A sparse item has no fully surveyed days to fall back on, so nothing is marked.
    const marked = sparse ? series : series.map((s) => (s.n >= minN ? s : { ...s, thin: true }));
    await writeFile(path.join(SERIES_DIR, `${code}.json`), JSON.stringify({ code, minN, sparse, series: marked }));
  }
  catalogue.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  await writeFile(path.join(OUT, 'items.json'), JSON.stringify(catalogue));

  console.log('Loading DOSM agriculture statistics...');
  const [cropsState, cropsDistrict, cropsArea, fishLandings, timber] = await Promise.all([
    fetchJson(`${API}/opendosm?id=crops_state&limit=100000`),
    fetchJson(`${API}/opendosm?id=crops_district_production&limit=100000`),
    fetchJson(`${API}/opendosm?id=crops_district_area&limit=100000`),
    fetchJson(`${API}/data-catalogue?id=fish_landings&limit=100000`),
    fetchJson(`${API}/data-catalogue?id=timber_production&limit=100000`),
  ]);
  await writeFile(path.join(OUT, 'crops.json'), JSON.stringify({
    state: cropsState, districtProduction: cropsDistrict, districtArea: cropsArea,
    fishLandings, timber,
  }));
  console.log(`Crops ${cropsState.length}, districts ${cropsDistrict.length}, fish ${fishLandings.length}, timber ${timber.length}`);

  if (!existsSync(path.join(OUT, 'palm.json'))) {
    console.log('Note: palm.json is missing. Run "npm run data:palm" for palm oil prices.');
  }

  const premiseTypes = {};
  for (const p of premises.values()) premiseTypes[p.type || 'unknown'] = (premiseTypes[p.type || 'unknown'] || 0) + 1;
  await writeFile(path.join(OUT, 'meta.json'), JSON.stringify({
    builtAt: new Date().toISOString(), months: loaded, rowsScanned: totalRows, items: catalogue.length,
    premises: premises.size, premiseTypes,
    sources: [
      { name: 'PriceCatcher (KPDN via data.gov.my / OpenDOSM)', url: 'https://open.dosm.gov.my/data-catalogue/pricecatcher', licence: 'CC BY 4.0' },
      { name: 'Crop Area & Production by State (DOSM)', url: 'https://open.dosm.gov.my/data-catalogue/crops_state', licence: 'CC BY 4.0' },
      { name: 'Crop Production by District (DOSM)', url: 'https://open.dosm.gov.my/data-catalogue/crops_district_production', licence: 'CC BY 4.0' },
      { name: 'Crop Area by District (DOSM)', url: 'https://open.dosm.gov.my/data-catalogue/crops_district_area', licence: 'CC BY 4.0' },
      { name: 'Monthly Landings of Marine Fish by State (DOSM)', url: 'https://open.dosm.gov.my/data-catalogue/fish_landings', licence: 'CC BY 4.0' },
      { name: 'Production of Major Timber Products by State (DOSM)', url: 'https://open.dosm.gov.my/data-catalogue/timber_production', licence: 'CC BY 4.0' },
    ],
  }, null, 2));
  console.log(`Done: ${catalogue.length} items, ${totalRows} rows scanned, months ${loaded.join(', ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
