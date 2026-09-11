/**
 * A startup feasibility model for a single farm venture.
 *
 * The split that matters here is between MEASURED inputs and ASSUMED ones. Market price
 * comes from PriceCatcher and crop yield from the DOSM district tables, so those are
 * observations. Everything else -- what share of the market price reaches the farm gate,
 * what a pond costs to dig, how much feed a fish eats -- is a planning assumption the
 * operator must replace with their own quotes. The UI labels them accordingly; this
 * module just does the arithmetic and never invents a number silently.
 */

export type VentureKind = 'aquaculture' | 'orchard' | 'annual-crop'

export interface VentureInputs {
  kind: VentureKind
  /** Ponds, or hectares. */
  scale: number
  /** Observed market price, RM per kg, before any farm gate discount. */
  marketPrice: number
  /** Fraction of the market price the grower actually receives, 0..1. */
  farmgateShare: number
  /** Saleable kg per unit per cycle (fish) or per unit per year at full maturity (crops). */
  yieldPerUnit: number
  /** Harvests per year. Tree and annual crops are usually 1. */
  cyclesPerYear: number
  /** One-off cost per unit to get started. */
  capexPerUnit: number
  /** Recurring cost per unit per cycle, excluding anything that scales with the harvest. */
  opexPerUnit: number
  /** Cost per kg harvested: picking, grading, transport. Scales with actual yield. */
  harvestCostPerKg: number
  /** Years before the first harvest. Zero for a pond stocked immediately. */
  gestationYears: number
  /** Year at which yield reaches 100%. Equal to gestationYears for crops with no ramp. */
  maturityYears: number
  /** How many years to project. */
  horizonYears: number
  /** Recurring cost per unit per year charged even before the first harvest. */
  upkeepBeforeHarvest: number
}

export interface YearRow {
  year: number
  yieldKg: number
  revenue: number
  capex: number
  operating: number
  net: number
  cumulative: number
}

export interface VentureResult {
  years: YearRow[]
  farmgatePrice: number
  startupCapital: number
  /** First year with any revenue, or null if the horizon ends before the first harvest. */
  firstIncomeYear: number | null
  /** Annual figures once the venture is at full yield. */
  steadyYieldKg: number
  steadyRevenue: number
  steadyOperating: number
  steadyProfit: number
  /** Year in which cumulative cash first turns positive, or null within the horizon. */
  paybackYear: number | null
  /** Farm gate price per kg at which a mature year exactly breaks even. */
  breakEvenPrice: number
  /** Break-even expressed against the market price, for comparison with the data. */
  breakEvenMarketPrice: number
  /** Return on the startup capital once mature, as a percentage. */
  returnOnCapital: number | null
}

/** Fraction of full yield in a given year, ramping linearly from first harvest to maturity. */
export function yieldFraction(year: number, gestation: number, maturity: number): number {
  if (year < gestation) return 0
  if (year >= maturity) return 1
  if (maturity <= gestation) return 1
  // Tree crops bear lightly at first. A straight ramp is crude but honest, and beats
  // pretending a five-year-old durian yields the same as a fifteen-year-old one.
  return (year - gestation + 1) / (maturity - gestation + 1)
}

export function computeVenture(input: VentureInputs): VentureResult {
  const {
    scale, marketPrice, farmgateShare, yieldPerUnit, cyclesPerYear,
    capexPerUnit, opexPerUnit, harvestCostPerKg, gestationYears, maturityYears,
    horizonYears, upkeepBeforeHarvest,
  } = input

  const farmgatePrice = marketPrice * farmgateShare
  const startupCapital = capexPerUnit * scale
  const fullYieldKg = yieldPerUnit * cyclesPerYear * scale

  const years: YearRow[] = []
  let cumulative = 0
  for (let year = 0; year <= horizonYears; year++) {
    const capex = year === 0 ? startupCapital : 0
    const fraction = yieldFraction(year, gestationYears, maturityYears)
    const yieldKg = fullYieldKg * fraction
    const revenue = yieldKg * farmgatePrice

    // Before the first harvest an orchard still has to be weeded, fertilised and watered.
    // Once it bears, the full per-cycle operating cost applies.
    const running = fraction > 0 ? opexPerUnit * cyclesPerYear * scale : upkeepBeforeHarvest * scale
    const operating = running + yieldKg * harvestCostPerKg

    const net = revenue - operating - capex
    cumulative += net
    years.push({ year, yieldKg, revenue, capex, operating, net, cumulative })
  }

  const firstIncome = years.find((y) => y.revenue > 0)
  const steadyOperating = opexPerUnit * cyclesPerYear * scale + fullYieldKg * harvestCostPerKg
  const steadyRevenue = fullYieldKg * farmgatePrice
  const steadyProfit = steadyRevenue - steadyOperating

  // Cumulative cash starts negative because of capex; find where it crosses back.
  const payback = years.find((y) => y.cumulative >= 0)

  // At break-even, revenue equals operating cost. Harvest cost scales with yield, so it
  // moves to the left-hand side rather than being treated as fixed.
  const breakEvenPrice =
    fullYieldKg > 0 ? (opexPerUnit * cyclesPerYear * scale) / fullYieldKg + harvestCostPerKg : Infinity

  return {
    years,
    farmgatePrice,
    startupCapital,
    firstIncomeYear: firstIncome ? firstIncome.year : null,
    steadyYieldKg: fullYieldKg,
    steadyRevenue,
    steadyOperating,
    steadyProfit,
    paybackYear: payback ? payback.year : null,
    breakEvenPrice,
    breakEvenMarketPrice: farmgateShare > 0 ? breakEvenPrice / farmgateShare : Infinity,
    returnOnCapital: startupCapital > 0 ? (steadyProfit / startupCapital) * 100 : null,
  }
}

/** Steady-state profit if the market price moved by `deltaPct`, holding costs fixed. */
export function profitAtPrice(input: VentureInputs, marketPrice: number): number {
  return computeVenture({ ...input, marketPrice }).steadyProfit
}
