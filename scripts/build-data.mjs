// Builds compact JSON for the app from DOSM / data.gov.my open data.
// Usage: node scripts/build-data.mjs [--months 6]
import { parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const MONTHS = Number(args[args.indexOf('--months') + 1] || 6);
const OUT = path.resolve('public/data');
const SERIES_DIR = path.join(OUT, 'series');
const STORAGE = 'https://storage.data.gov.my/pricecatcher';
const API = 'https://api.data.gov.my';

// Agriculture / horticulture categories inside PriceCatcher (KPDN survey, published via DOSM).
const AGRI_CATEGORIES = new Set([
  'BUAH-BUAHAN', 'SAYUR-SAYURAN', 'KELAPA', 'BAWANG', 'KACANG', 'UBI KENTANG',
  'REMPAH RATUS (TIDAK BERBUNGKUS)', 'CILI KERING', 'BERAS', 'TELUR',
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
        code: Number(it.item_code), name: it.item, unit: it.unit, group: it.item_group,
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
    const last = series[series.length - 1];
    const lastDate = new Date(last.d);
    const at = (daysAgo) => {
      const target = ymd(new Date(lastDate.getTime() - daysAgo * 86400000));
      let best = null;
      for (const s of series) {
        if (s.d <= target) best = s;
        else break;
      }
      return best;
    };
    const pct = (a, b) => (a && b ? round(((a.avg - b.avg) / b.avg) * 100, 1) : null);
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
      spark: series.slice(-30).map((s) => s.avg),
      activePremises: active30.size, activeByState,
      first: series[0].d, points: series.length,
    });
    await writeFile(path.join(SERIES_DIR, `${code}.json`), JSON.stringify({ code, series }));
  }
  catalogue.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  await writeFile(path.join(OUT, 'items.json'), JSON.stringify(catalogue));

  console.log('Loading DOSM crop statistics...');
  const cropsState = await fetchJson(`${API}/opendosm?id=crops_state&limit=100000`);
  const cropsDistrict = await fetchJson(`${API}/opendosm?id=crops_district_production&limit=100000`);
  const cropsArea = await fetchJson(`${API}/opendosm?id=crops_district_area&limit=100000`);
  await writeFile(path.join(OUT, 'crops.json'), JSON.stringify({
    state: cropsState, districtProduction: cropsDistrict, districtArea: cropsArea,
  }));

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
    ],
  }, null, 2));
  console.log(`Done: ${catalogue.length} items, ${totalRows} rows scanned, months ${loaded.join(', ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
