import type { CropsData, Item, ItemSeries, Meta, PalmData } from './types'

const base = import.meta.env.BASE_URL

async function load<T>(file: string): Promise<T> {
  const res = await fetch(`${base}data/${file}`)
  if (!res.ok) throw new Error(`Could not load ${file} (${res.status}). Run "npm run data" first.`)
  return res.json() as Promise<T>
}

export const loadItems = () => load<Item[]>('items.json')
export const loadMeta = () => load<Meta>('meta.json')
export const loadPalm = () => load<PalmData>('palm.json')
export const loadCrops = () => load<CropsData>('crops.json')

const seriesCache = new Map<number, Promise<ItemSeries>>()

export function loadSeries(code: number): Promise<ItemSeries> {
  let hit = seriesCache.get(code)
  if (!hit) {
    hit = load<ItemSeries>(`series/${code}.json`)
    seriesCache.set(code, hit)
  }
  return hit
}
