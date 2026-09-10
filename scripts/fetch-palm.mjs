// Fetches Malaysia's daily crude palm oil (CPO) price from MPOB's public chart endpoint
// and derives an indicative fresh fruit bunch (FFB) farmgate price.
//
// Usage: node scripts/fetch-palm.mjs [--range 6M] [--oer 0.195] [--milling 0.72]
//
// MPOB publishes the official FFB reference price at 1% OER separately at
// https://bepi.mpob.gov.my. Only the CPO series is machine readable, so FFB here is an
// ESTIMATE: ffb = cpo * oer * millingShare. Both factors are configurable and the output
// records them so the app can label the number as derived rather than official.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i === -1 ? fallback : args[i + 1];
};

const RANGE = arg('--range', '6M'); // 1M | 3M | 6M
const OER = Number(arg('--oer', '0.195')); // national average oil extraction rate
const MILLING = Number(arg('--milling', '0.72')); // share of oil value paid to the grower
const OUT = path.resolve('public/data');
const SRC = `https://bepi.mpob.gov.my/admin2/chart_cpomsia_mini.php?jenis=${RANGE}`;

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function block(html, key) {
  const start = html.indexOf(key);
  if (start === -1) throw new Error(`could not find "${key}" in MPOB response`);
  const open = html.indexOf('[', start);
  const close = html.indexOf(']', open);
  return html.slice(open + 1, close);
}

function parseCategories(html) {
  return block(html, 'categories:')
    .split(',')
    .map((s) => s.replace(/['"\s]/g, ''))
    .filter(Boolean);
}

function parseValues(html) {
  return block(html, 'data:')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

// Categories look like "Jun09" (day-of-month, no year). Walk backwards from today so
// a series that straddles a year boundary still resolves correctly.
function resolveDates(labels) {
  const today = new Date();
  const out = new Array(labels.length);
  let year = today.getUTCFullYear();
  let prevMonth = null;
  for (let i = labels.length - 1; i >= 0; i--) {
    const m = labels[i].match(/^([A-Za-z]{3})(\d{1,2})$/);
    if (!m) { out[i] = null; continue; }
    const month = MONTHS[m[1].toLowerCase()];
    const day = Number(m[2]);
    if (prevMonth !== null && month > prevMonth) year -= 1;
    prevMonth = month;
    out[i] = new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
  }
  return out;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log(`Fetching MPOB CPO prices (${RANGE})...`);
  const res = await fetch(SRC, { headers: { 'User-Agent': 'Mozilla/5.0 (pokoks price dashboard)' } });
  if (!res.ok) throw new Error(`MPOB responded ${res.status}`);
  const html = await res.text();

  const labels = parseCategories(html);
  const values = parseValues(html);
  const n = Math.min(labels.length, values.length);
  if (n < 5) throw new Error(`only ${n} usable points returned; MPOB page layout may have changed`);
  if (labels.length !== values.length) {
    console.warn(`label/value length mismatch (${labels.length} vs ${values.length}); using first ${n}`);
  }
  const dates = resolveDates(labels.slice(0, n));

  const series = [];
  for (let i = 0; i < n; i++) {
    if (!dates[i]) continue;
    const cpo = values[i];
    series.push({
      date: dates[i],
      cpo_rm_per_tonne: cpo,
      ffb_rm_per_tonne: Math.round(cpo * OER * MILLING * 100) / 100,
    });
  }
  series.sort((a, b) => a.date.localeCompare(b.date));

  await writeFile(path.join(OUT, 'palm.json'), JSON.stringify({
    fetchedAt: new Date().toISOString(),
    range: RANGE,
    source: { name: 'MPOB Economics & Industry Development Division', url: 'https://bepi.mpob.gov.my' },
    cpo: { basis: 'Malaysia daily average crude palm oil price', unit: 'RM per tonne', official: true },
    ffb: {
      basis: 'Derived: cpo x oer x millingShare. Not the official MPOB FFB reference price.',
      unit: 'RM per tonne', official: false, oer: OER, millingShare: MILLING,
    },
    series,
  }, null, 2));
  console.log(`Done: ${series.length} days, ${series[0].date} to ${series[series.length - 1].date}`);
  console.log(`Latest CPO RM${series[series.length - 1].cpo_rm_per_tonne}/t, est. FFB RM${series[series.length - 1].ffb_rm_per_tonne}/t`);
}

main().catch((e) => {
  console.error(`fetch-palm failed: ${e.message}`);
  process.exit(1);
});
