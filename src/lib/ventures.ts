import type { VentureInputs, VentureKind } from './venture'

/**
 * Starting points for the feasibility calculator.
 *
 * Every cost here is a PLANNING ASSUMPTION, not a measured figure. Malaysia publishes no
 * machine-readable farm cost survey, so these are order-of-magnitude defaults meant to be
 * overwritten with real quotes. They are kept in one place, each with a note saying what
 * it represents, so nothing is buried in a component.
 *
 * The two things that are measured come from elsewhere and are injected at runtime:
 *   - market price, from PriceCatcher
 *   - crop yield per hectare, from the DOSM district production and area tables
 */

export interface VenturePreset {
  id: string
  label: string
  kind: VentureKind
  /** What one unit of scale means, e.g. "pond" or "hectare". */
  unit: string
  unitPlural: string
  /** PriceCatcher item code whose price drives revenue, when one exists. */
  itemCode: number | null
  /** Crop species key in the DOSM district tables, when one exists. */
  species: string | null
  /** Shown under the venture picker. */
  blurb: string
  defaults: Omit<VentureInputs, 'kind' | 'marketPrice'>
  /** Per-field explanation of where a default came from. */
  notes: Partial<Record<keyof VentureInputs, string>>
  /** Set when there is no price feed and the operator must supply the price. */
  priceIsManual?: boolean
  /** Used when priceIsManual, as a clearly-labelled placeholder. */
  manualPriceDefault?: number
}

export const PRESETS: VenturePreset[] = [
  {
    id: 'tilapia',
    label: 'Kolam ikan tilapia',
    kind: 'aquaculture',
    unit: 'pond',
    unitPlural: 'ponds',
    itemCode: 1921, // IKAN TILAPIA MERAH (2-5 ekor sekilogram)
    species: null,
    blurb:
      'Earthen grow-out pond of about 1,000 m², stocked with red tilapia fingerlings and ' +
      'harvested at roughly 400 g, which is the 2 to 5 fish per kilogram grade the price ' +
      'survey tracks.',
    defaults: {
      scale: 2,
      farmgateShare: 0.55,
      // 5,000 fingerlings at 5/m², 80% survival, 0.45 kg average harvest weight.
      yieldPerUnit: 1800,
      cyclesPerYear: 2,
      // Excavation, inlet and outlet works, aerator, netting and sundries.
      capexPerUnit: 21000,
      // Feed dominates: 1.7 kg feed per kg gain at about RM2.90/kg, plus fingerlings,
      // lime, power and part-time labour.
      opexPerUnit: 13000,
      harvestCostPerKg: 0.6,
      gestationYears: 0,
      maturityYears: 0,
      horizonYears: 10,
      upkeepBeforeHarvest: 0,
    },
    notes: {
      farmgateShare:
        'A farmer sells to a collector, not a shopper. Malaysian pond gate prices typically ' +
        'run a little over half the wet market price. Get a real quote from your buyer.',
      yieldPerUnit:
        '5,000 fingerlings per pond at 5 per m², 80% survival, 0.45 kg average at harvest.',
      capexPerUnit: 'Pond excavation, inlet and outlet, one aerator, netting and sundries.',
      opexPerUnit:
        'Per cycle. Feed at 1.7 kg per kg of gain, fingerlings, lime, power and part-time labour.',
      cyclesPerYear: 'Roughly six months from stocking to harvest, so two crops a year.',
    },
  },
  {
    id: 'durian',
    label: 'Dusun durian',
    kind: 'orchard',
    unit: 'hectare',
    unitPlural: 'hectares',
    itemCode: null, // Durian is absent from PriceCatcher entirely.
    species: 'durian',
    blurb:
      'Grafted durian at about 100 trees per hectare on a 10 by 10 metre spacing. The long ' +
      'wait before the first fruit is the whole story of this business.',
    defaults: {
      scale: 2,
      farmgateShare: 1, // The manual price is already entered as a farm gate price.
      yieldPerUnit: 2913, // Overwritten by the measured DOSM yield for the chosen state.
      cyclesPerYear: 1,
      // Land clearing, planting holes, 100 grafted seedlings, irrigation and fencing.
      capexPerUnit: 27000,
      // Fertiliser, pest and disease control, weeding and general upkeep once bearing.
      opexPerUnit: 9000,
      harvestCostPerKg: 0.5,
      gestationYears: 5,
      maturityYears: 9,
      horizonYears: 15,
      // An orchard still needs weeding, fertiliser and water in the years before it bears.
      upkeepBeforeHarvest: 5000,
    },
    notes: {
      yieldPerUnit:
        'Measured from the DOSM district tables. That average spans young, old and unmanaged ' +
        'orchards, so a well run mature block should beat it. Raise it if your agronomy warrants.',
      capexPerUnit:
        'Land clearing, planting holes, 100 grafted seedlings, irrigation and fencing, per hectare.',
      opexPerUnit: 'Per bearing year: fertiliser, pest and disease control, weeding, upkeep.',
      gestationYears: 'Grafted stock usually sets its first commercial fruit in year five.',
      maturityYears: 'Yield keeps climbing until the trees are roughly nine years old.',
      upkeepBeforeHarvest: 'Yearly cost of keeping the orchard alive before it earns anything.',
    },
    priceIsManual: true,
    // Ordinary kampung varieties sell far below the premium clones. Deliberately
    // conservative, and the field is unmissable in the UI.
    manualPriceDefault: 12,
  },
  {
    id: 'crop',
    label: 'Tanaman lain',
    kind: 'annual-crop',
    unit: 'hectare',
    unitPlural: 'hectares',
    itemCode: null,
    species: null,
    blurb:
      'Any crop where the data carries both a measured yield per hectare and a live market ' +
      'price. Pick one and both figures are filled in for you.',
    defaults: {
      scale: 1,
      farmgateShare: 0.55,
      yieldPerUnit: 20000,
      cyclesPerYear: 1,
      capexPerUnit: 15000,
      opexPerUnit: 12000,
      harvestCostPerKg: 0.4,
      gestationYears: 0,
      maturityYears: 0,
      horizonYears: 10,
      upkeepBeforeHarvest: 0,
    },
    notes: {
      yieldPerUnit: 'Measured from the DOSM district production and planted area tables.',
      capexPerUnit: 'Land preparation, irrigation and basic structures. Replace with your own costing.',
      opexPerUnit: 'Per season: seed or seedlings, fertiliser, crop protection and labour.',
      farmgateShare: 'Share of the surveyed market price that reaches the grower.',
    },
  },
]

/**
 * Crop species in the DOSM tables paired with the PriceCatcher item that best represents
 * them. Only pairs measured in the same unit are listed: pineapple and coconut are priced
 * per fruit rather than per kilogram, so they are deliberately left out rather than
 * silently converted.
 */
export const SPECIES_TO_ITEM: { species: string; itemCode: number; label: string }[] = [
  { species: 'tomato', itemCode: 114, label: 'Tomato' },
  { species: 'cucumber', itemCode: 113, label: 'Timun' },
  { species: 'cabbage', itemCode: 105, label: 'Kubis bulat' },
  { species: 'long_bean', itemCode: 98, label: 'Kacang panjang' },
  { species: 'ladys_finger', itemCode: 96, label: 'Kacang bendi' },
  { species: 'brinjal', itemCode: 1923, label: 'Terung' },
  { species: 'water_spinach', itemCode: 1559, label: 'Kangkung' },
  { species: 'chinese_spinach', itemCode: 1556, label: 'Bayam hijau' },
  { species: 'mustard', itemCode: 1558, label: 'Sawi hijau' },
  { species: 'papaya', itemCode: 16, label: 'Betik' },
  { species: 'banana', itemCode: 18, label: 'Pisang berangan' },
  { species: 'watermelon', itemCode: 20, label: 'Tembikai merah' },
  { species: 'guava', itemCode: 38, label: 'Jambu batu' },
  { species: 'red_chilli', itemCode: 93, label: 'Cili merah' },
  { species: 'french_bean', itemCode: 97, label: 'Kacang buncis' },
]
