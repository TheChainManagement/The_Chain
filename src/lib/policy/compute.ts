/**
 * Inventory policy math (Block 9) — pure, no I/O.
 *
 * Derives the replenishment policy for one (SKU, location) from the promoted
 * forecast's own uncertainty:
 *
 *  - **Demand stats from the model's bands.** Weekly σ comes from the forecast's
 *    80% interval (hi80 − lo80 = 2·z₈₀·σ_w under normality), so the policy
 *    inherits exactly the uncertainty the model measured — no second estimate
 *    to drift from the first.
 *
 *  - **Safety stock** = z · √(L·σ_d² + d̄²·σ_L²) — demand variability over the
 *    lead time plus lead-time variability (σ_L from the supplier scorecard when
 *    its sample is real, Block 10 feeds it). With σ_L = 0 this reduces to the
 *    classic z·σ·√L.
 *
 *  - **Reorder point** = demand during lead time + safety stock.
 *
 *  - **Recommended order qty** = max(MOQ, coverage-days demand). True EOQ needs
 *    ordering + holding cost parameters the schema doesn't carry yet — that is
 *    the documented post-MVP tightening (docs/INVENTORY_OPTIMIZATION_NOTES.md),
 *    not silently approximated.
 *
 *  - **Days of Supply** = position ÷ daily demand. **Stockout risk** =
 *    P(demand during lead time > position − safety stock): the probability the
 *    next replenishment cycle ends below safety stock, under the same normal
 *    model the bands came from.
 */

/** Service-level slider clamp (FEATURES: 90% → 99.5%). */
export const SERVICE_LEVEL_MIN = 0.9;
export const SERVICE_LEVEL_MAX = 0.995;
/** Scorecard lead-time σ only counts once its sample is real (FEATURES). */
export const SCORECARD_MIN_SAMPLE = 5;

const Z80 = 1.2815515655; // Φ⁻¹(0.9): the 80% interval spans ±z₈₀·σ

export function clampServiceLevel(v: number): number {
  if (Number.isNaN(v)) return 0.97;
  return Math.min(SERVICE_LEVEL_MAX, Math.max(SERVICE_LEVEL_MIN, v));
}

/**
 * Inverse standard-normal CDF (Acklam's rational approximation, |ε| < 1.15e-9
 * over (0,1)). Plenty for service-level z-scores.
 */
// Acklam coefficients (named so indexed access never needs a non-null assert).
const A0 = -3.969683028665376e1;
const A1 = 2.209460984245205e2;
const A2 = -2.759285104469687e2;
const A3 = 1.38357751867269e2;
const A4 = -3.066479806614716e1;
const A5 = 2.506628277459239;
const B0 = -5.447609879822406e1;
const B1 = 1.615858368580409e2;
const B2 = -1.556989798598866e2;
const B3 = 6.680131188771972e1;
const B4 = -1.328068155288572e1;
const C0 = -7.784894002430293e-3;
const C1 = -3.223964580411365e-1;
const C2 = -2.400758277161838;
const C3 = -2.549732539343734;
const C4 = 4.374664141464968;
const C5 = 2.938163982698783;
const D0 = 7.784695709041462e-3;
const D1 = 3.224671290700398e-1;
const D2 = 2.445134137142996;
const D3 = 3.754408661907416;
const P_LOW = 0.02425;

function invNormTail(q: number): number {
  return (
    (((((C0 * q + C1) * q + C2) * q + C3) * q + C4) * q + C5) /
    ((((D0 * q + D1) * q + D2) * q + D3) * q + 1)
  );
}

export function invNorm(p: number): number {
  if (p <= 0 || p >= 1) throw new Error(`invNorm domain: ${p}`);

  if (p < P_LOW) {
    return invNormTail(Math.sqrt(-2 * Math.log(p)));
  }
  if (p <= 1 - P_LOW) {
    const q = p - 0.5;
    const r = q * q;
    return (
      ((((((A0 * r + A1) * r + A2) * r + A3) * r + A4) * r + A5) * q) /
      (((((B0 * r + B1) * r + B2) * r + B3) * r + B4) * r + 1)
    );
  }
  return -invNormTail(Math.sqrt(-2 * Math.log(1 - p)));
}

/** Standard-normal CDF via the complementary error function (Abramowitz-Stegun 7.1.26). */
export function normCdf(x: number): number {
  const t = 1 / (1 + (0.3275911 * Math.abs(x)) / Math.SQRT2);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp((-x * x) / 2);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

export interface BandPoint {
  mean: number | null;
  lo80: number | null;
  hi80: number | null;
  lo95: number | null;
  hi95: number | null;
}

export interface DemandStats {
  /** Mean daily demand over the forecast horizon. */
  dailyMean: number;
  /** Daily demand σ implied by the model's own intervals. */
  dailySigma: number;
}

/**
 * Demand stats from forecast points. σ_w from the FIRST forecast week's band —
 * the one-step-ahead uncertainty, which is what lead-time convolution wants
 * (later bands compound horizon uncertainty). 80% band preferred; 95% fallback.
 */
export function demandStatsFromPoints(points: BandPoint[]): DemandStats | null {
  const means = points.map((p) => p.mean).filter((m): m is number => m != null);
  if (means.length === 0) return null;
  const weeklyMean = means.reduce((a, b) => a + b, 0) / means.length;

  const first = points.find((p) => p.mean != null);
  let weeklySigma: number | null = null;
  if (first && first.lo80 != null && first.hi80 != null) {
    weeklySigma = Math.max(0, (first.hi80 - first.lo80) / (2 * Z80));
  } else if (first && first.lo95 != null && first.hi95 != null) {
    weeklySigma = Math.max(0, (first.hi95 - first.lo95) / (2 * 1.9599639845));
  }
  if (weeklySigma == null) return null;

  return { dailyMean: weeklyMean / 7, dailySigma: weeklySigma / Math.sqrt(7) };
}

export interface PolicyInputs {
  dailyMean: number;
  dailySigma: number;
  /** Lead time actually used (supplier-configured or scorecard-empirical). */
  leadTimeDays: number;
  /** Scorecard lead-time σ in days; 0 when the sample isn't real yet. */
  leadSigmaDays: number;
  serviceLevel: number;
  /** Primary-supplier minimum order quantity (floor for the recommendation). */
  moq: number | null;
  /** Days of demand one order should cover (the practical EOQ stand-in). */
  coverageDays: number;
  /** Net stock position: on_hand − on_hold + in_transit − allocated (netPosition). Null when unknown. */
  position: number | null;
}

export interface PolicyOutputs {
  z: number;
  demandDuringLeadTime: number;
  sigmaLeadTime: number;
  safetyStock: number;
  reorderPoint: number;
  recommendedOrderQty: number;
  daysOfSupply: number | null;
  stockoutRisk: number | null;
}

export function derivePolicy(i: PolicyInputs): PolicyOutputs {
  const serviceLevel = clampServiceLevel(i.serviceLevel);
  const z = invNorm(serviceLevel);
  const L = Math.max(0, i.leadTimeDays);

  const demandDuringLeadTime = i.dailyMean * L;
  const sigmaLeadTime = Math.sqrt(L * i.dailySigma ** 2 + i.dailyMean ** 2 * i.leadSigmaDays ** 2);
  const safetyStock = z * sigmaLeadTime;
  const reorderPoint = demandDuringLeadTime + safetyStock;
  const recommendedOrderQty = Math.max(i.moq ?? 0, Math.ceil(i.dailyMean * i.coverageDays));

  const daysOfSupply = i.position == null || i.dailyMean <= 0 ? null : i.position / i.dailyMean;

  // P(cycle ends below safety stock) = P(D_LT > position − SS). Degenerate σ:
  // the verdict is deterministic.
  let stockoutRisk: number | null = null;
  if (i.position != null) {
    if (sigmaLeadTime <= 0) {
      stockoutRisk = demandDuringLeadTime > i.position - safetyStock ? 1 : 0;
    } else {
      stockoutRisk = 1 - normCdf((i.position - safetyStock - demandDuringLeadTime) / sigmaLeadTime);
    }
  }

  return {
    z,
    demandDuringLeadTime,
    sigmaLeadTime,
    safetyStock,
    reorderPoint,
    recommendedOrderQty,
    daysOfSupply,
    stockoutRisk,
  };
}

export type LeadTimeSource = 'supplier' | 'scorecard';

export interface LeadTimeChoice {
  days: number;
  sigmaDays: number;
  source: LeadTimeSource;
}

/**
 * FEATURES rule: the configured `product_suppliers.lead_time_days` is the lead
 * time, UNLESS the supplier scorecard has a real sample (≥5 received POs) —
 * then the empirical average + stddev win. Returns null when neither exists
 * (the SKU is skipped, never defaulted: no invented lead times).
 */
export function chooseLeadTime(
  configuredDays: number | null,
  scorecard: { avgDays: number | null; stddevDays: number | null; sampleSize: number } | null,
): LeadTimeChoice | null {
  if (
    scorecard &&
    scorecard.sampleSize >= SCORECARD_MIN_SAMPLE &&
    scorecard.avgDays != null &&
    scorecard.avgDays > 0
  ) {
    return {
      days: scorecard.avgDays,
      sigmaDays: Math.max(0, scorecard.stddevDays ?? 0),
      source: 'scorecard',
    };
  }
  if (configuredDays != null && configuredDays > 0) {
    return { days: configuredDays, sigmaDays: 0, source: 'supplier' };
  }
  return null;
}
