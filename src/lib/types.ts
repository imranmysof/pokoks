export type Channel = 'borong' | 'pasar' | 'runcit'

export interface ChannelPoint {
  avg: number
  n: number
}

/** One day of aggregated prices for a single item. */
export interface SeriesPoint {
  d: string
  avg: number
  med: number
  /** Interquartile range across reporting premises. */
  p25?: number
  p75?: number
  min: number
  max: number
  /** Distinct premises reporting that day. */
  n: number
  ch: Partial<Record<Channel, ChannelPoint>>
  st: Record<string, number>
}

export interface ItemSeries {
  code: number
  series: SeriesPoint[]
}

export interface Item {
  code: number
  name: string
  unit: string
  group: string
  category: string
  /** Palm-based cooking oil. */
  palm: boolean
  /** Mass of one unit in kg, or null when the unit is not mass based. */
  kg: number | null
  latest: {
    date: string
    avg: number
    med: number
    min: number
    max: number
    n: number
  }
  borong: number | null
  pasar: number | null
  runcit: number | null
  change7: number | null
  change30: number | null
  change90: number | null
  spark: number[]
  activePremises: number
  activeByState: Record<string, number>
  first: string
  points: number
}

export interface PalmPoint {
  date: string
  cpo_rm_per_tonne: number
  ffb_rm_per_tonne: number
}

export interface PalmData {
  fetchedAt: string
  range: string
  source: { name: string; url: string }
  cpo: { basis: string; unit: string; official: boolean }
  ffb: { basis: string; unit: string; official: boolean; oer: number; millingShare: number }
  series: PalmPoint[]
}

export interface CropStateRow {
  date: string
  state: string
  crop_type: string
  production: number
  planted_area: number
}

export interface CropDistrictRow {
  date: string
  state: string
  district: string
  crop_type: string
  crop_species: string
  production?: number
  planted_area?: number
}

export interface CropsData {
  state: CropStateRow[]
  districtProduction: CropDistrictRow[]
  districtArea: CropDistrictRow[]
}

export interface Meta {
  builtAt: string
  months: string[]
  rowsScanned: number
  items: number
  premises: number
  premiseTypes: Record<string, number>
  sources: { name: string; url: string; licence: string }[]
}
