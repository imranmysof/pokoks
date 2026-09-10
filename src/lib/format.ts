const rm = new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR', minimumFractionDigits: 2 })
const rm0 = new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR', maximumFractionDigits: 0 })
const num = new Intl.NumberFormat('en-MY')
const num1 = new Intl.NumberFormat('en-MY', { maximumFractionDigits: 1 })

export const money = (v: number | null | undefined) => (v == null ? '—' : rm.format(v))
export const moneyWhole = (v: number | null | undefined) => (v == null ? '—' : rm0.format(v))
export const count = (v: number | null | undefined) => (v == null ? '—' : num.format(v))
export const decimal = (v: number | null | undefined) => (v == null ? '—' : num1.format(v))

export const pct = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return '—'
  // Round first, so a value like -0.02 prints as 0.0% rather than -0%.
  const rounded = Math.round(v * 10) / 10 || 0
  const sign = rounded > 0 ? '+' : ''
  return `${sign}${num1.format(rounded)}%`
}

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })

export const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' })

/** Title-cases the shouty Bahasa Malaysia labels that PriceCatcher ships. */
export function tidy(name: string) {
  return name
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\bDan\b/g, 'dan')
    .replace(/\bCap\b/g, 'cap')
    .replace(/\bTidak\b/g, 'tidak')
}

export const CATEGORY_LABEL: Record<string, string> = {
  'BUAH-BUAHAN': 'Fruit',
  'SAYUR-SAYURAN': 'Vegetables',
  KELAPA: 'Coconut',
  BAWANG: 'Onions & garlic',
  KACANG: 'Beans & nuts',
  'UBI KENTANG': 'Potatoes & tubers',
  'REMPAH RATUS (TIDAK BERBUNGKUS)': 'Loose spices',
  'CILI KERING': 'Dried chilli',
  BERAS: 'Rice',
  TELUR: 'Eggs',
  AYAM: 'Chicken',
  DAGING: 'Meat',
  'BAHAN LAUT': 'Marine fish & seafood',
  'IKAN DARAT': 'Freshwater fish',
  'HASIL LAUT KERING': 'Dried seafood',
  'MINYAK DAN LEMAK': 'Palm cooking oil',
}

export const categoryLabel = (c: string) => CATEGORY_LABEL[c] ?? tidy(c)

/** Broad sector a price category belongs to, used to group the item list. */
export type Sector = 'horticulture' | 'livestock' | 'fisheries' | 'palm'

export const SECTOR_LABEL: Record<Sector, string> = {
  horticulture: 'Crops & horticulture',
  livestock: 'Livestock & poultry',
  fisheries: 'Fish & seafood',
  palm: 'Palm oil',
}

/** Compact form for the sector switcher, which has to fit on a phone. */
export const SECTOR_SHORT: Record<Sector, string> = {
  horticulture: 'Crops',
  livestock: 'Livestock',
  fisheries: 'Fish',
  palm: 'Palm',
}

const SECTOR_OF: Record<string, Sector> = {
  AYAM: 'livestock',
  DAGING: 'livestock',
  TELUR: 'livestock',
  'BAHAN LAUT': 'fisheries',
  'IKAN DARAT': 'fisheries',
  'HASIL LAUT KERING': 'fisheries',
  'MINYAK DAN LEMAK': 'palm',
}

export const sectorOf = (category: string): Sector => SECTOR_OF[category] ?? 'horticulture'

export const CHANNEL_LABEL: Record<string, string> = {
  borong: 'Borong (wholesale)',
  pasar: 'Pasar basah (wet market)',
  runcit: 'Runcit (retail)',
}

/** Price converted to RM per kilogram, when the unit allows it. */
export function perKg(price: number | null | undefined, kg: number | null): number | null {
  if (price == null || !kg) return null
  return price / kg
}

/** Price converted to RM per tonne, when the unit allows it. */
export function perTonne(price: number | null | undefined, kg: number | null): number | null {
  const k = perKg(price, kg)
  return k == null ? null : k * 1000
}
