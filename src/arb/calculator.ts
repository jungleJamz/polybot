import type { KellySize, MarketType } from "../types.js";
import {
  BOOKMAKER_WEIGHTS,
  MAKER_MARGINS,
  TAKER_MARGINS,
  KELLY_MULTIPLIER,
  MAX_PER_MARKET_FRACTION,
  MAX_PER_BUCKET_FRACTION,
} from "../config.js";

// ============================================================================
// STATISTICAL UTILITIES
// ============================================================================

/**
 * Standard normal cumulative distribution function (CDF)
 * Uses Abramowitz and Stegun approximation (accurate to 7 decimal places)
 */
// normCdf: Abramowitz & Stegun polynomial approximation
function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const prob =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - prob : prob;
}

// invNormCdf: Beasley-Springer-Moro algorithm
/**
 * Inverse standard normal CDF (quantile function)
 * Uses Beasley-Springer-Moro algorithm
 */
function invNormCdf(p: number): number {
  // Clamp to avoid numerical issues
  p = Math.max(1e-10, Math.min(1 - 1e-10, p));

  const a: number[] = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b: number[] = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c: number[] = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d: number[] = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  let q: number, r: number;

  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q +
        c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  } else if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (
      ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r +
        a[5]!) *
        q) /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
    );
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(
        ((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q +
        c[5]!
      ) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }
}

/**
 * Bisection root-finding method
 */
function bisection(
  f: (x: number) => number,
  a: number,
  b: number,
  tol: number = 1e-8,
  maxIter: number = 100,
): number | null {
  let fa = f(a);
  let fb = f(b);

  if (fa * fb > 0) {
    return null; // No root in interval
  }

  for (let i = 0; i < maxIter; i++) {
    const c = (a + b) / 2;
    const fc = f(c);

    if (Math.abs(fc) < tol || Math.abs(b - a) < tol) {
      return c;
    }

    if (fa * fc < 0) {
      b = c;
      fb = fc;
    } else {
      a = c;
      fa = fc;
    }
  }

  return (a + b) / 2; // Return midpoint if max iterations reached
}

// ============================================================================
// ODDS CONVERSION
// ============================================================================

//Convert American odds --> decimal odds
export function americanToDecimal(americanOdds: number): number {
  if (americanOdds > 0) {
    return americanOdds / 100 + 1;
  } else {
    return 100 / Math.abs(americanOdds) + 1;
  }
}

//Convert decimal --> implied probability (raw, with vig)
export function decimalToImpliedProb(decimalOdds: number): number {
  // Clamp to avoid division by zero or negative odds
  if (decimalOdds <= 1.01) return 0.99;
  if (decimalOdds > 1000) return 0.001;
  return 1 / decimalOdds;
}

// Convert American odds --> implied probability (legacy - kept for compatibility)
export function americanToImpliedProb(americanOdds: number): number {
  return decimalToImpliedProb(americanToDecimal(americanOdds));
}

// Convert Decimal odds --> American odds
/**
 * Convert decimal odds to American odds
 */
export function decimalToAmerican(decimalOdds: number): number {
  if (decimalOdds < 1.01) {
    throw new Error(
      `decimalToAmerican requires decimalOdds >= 1.01, got ${decimalOdds}`,
    );
  }
  // Favorite
  if (decimalOdds < 2) {
    return Math.round(-100 / (decimalOdds - 1));
  }
  // Underdog
  return Math.round((decimalOdds - 1) * 100);
}

// ============================================================================
// DE-VIGGING ALGORITHMS
// ============================================================================
export function devigMoneylinePower(decimalOdds: number[]): number[] {
  const q = decimalOdds.map((odds) => decimalToImpliedProb(odds));
  const qSum = q.reduce((sum, qi) => sum + qi, 0);
  if (Math.abs(qSum - 1) < 0.0001) return q;

  const f = (k: number): number =>
    q.reduce((sum, qi) => sum + Math.pow(qi, k), 0) - 1;

  const k = bisection(f, 0.2, 2.0);
  if (k === null) {
    console.warn(`[devig] Power method failed, falling back to proportional`);
    return q.map((qi) => qi / qSum);
  }

  const powered = q.map((qi) => Math.pow(qi, k));
  const Z = powered.reduce((sum, p) => sum + p, 0);
  return powered.map((p) => p / Z);
}

export function devigTwoWayProbit(
  odds1: number,
  odds2: number,
): [number, number] {
  let q1 = Math.max(1e-6, Math.min(1 - 1e-6, decimalToImpliedProb(odds1)));
  let q2 = Math.max(1e-6, Math.min(1 - 1e-6, decimalToImpliedProb(odds2)));

  if (Math.abs(q1 + q2 - 1) < 0.0001) return [q1, q2];

  const z1 = invNormCdf(q1);
  const z2 = invNormCdf(q2);

  const g = (m: number): number => normCdf(z1 - m) + normCdf(z2 - m) - 1;
  const m = bisection(g, -3.0, 3.0);

  if (m === null) {
    console.warn(`[devig] Probit method failed, falling back to proportional`);
    const total = q1 + q2;
    return [q1 / total, q2 / total];
  }

  const p1Raw = normCdf(z1 - m);
  const p2Raw = normCdf(z2 - m);
  const Z = p1Raw + p2Raw;
  return [p1Raw / Z, p2Raw / Z];
}

// ============================================================================
// WEIGHTED CONSENSUS
// ============================================================================

/**
 * Calculate weighted consensus odds from multiple bookmakers
 * Uses sophisticated de-vigging (Power for moneylines, Probit for spreads/totals)
 * and brand-level weighting with dynamic renormalization
 */
export function calculateWeightedConsensus(
  bookmakerOdds: Array<{
    bookmaker: string;
    outcome1Price: number; // American odds
    outcome2Price: number;
  }>,
  marketType: MarketType,
): { consensus1: number; consensus2: number } | null {
  if (bookmakerOdds.length === 0) {
    return null;
  }

  // ---------------------------------------------------------------------------
  // Normalize bookmaker weights
  // Only included bookmakers contribute to the consensus.
  // ---------------------------------------------------------------------------

  let totalWeight = 0;

  const normalizedWeights: Record<string, number> = {};

  for (const { bookmaker } of bookmakerOdds) {
    const weight =
      (BOOKMAKER_WEIGHTS as Record<string, number>)[bookmaker] ?? 0;

    totalWeight += weight;
    normalizedWeights[bookmaker] = weight;
  }

  if (totalWeight === 0) {
    return null;
  }

  for (const bookmaker in normalizedWeights) {
    normalizedWeights[bookmaker] = normalizedWeights[bookmaker]! / totalWeight;
  }

  // ---------------------------------------------------------------------------
  // Calculate weighted fair probabilities
  // ---------------------------------------------------------------------------

  let weightedFair1 = 0;
  let weightedFair2 = 0;

  for (const { bookmaker, outcome1Price, outcome2Price } of bookmakerOdds) {
    const weight = normalizedWeights[bookmaker];

    if (!weight) {
      continue;
    }

    // Convert American odds → decimal odds
    const decimal1 = americanToDecimal(outcome1Price);
    const decimal2 = americanToDecimal(outcome2Price);

    let fair1: number;
    let fair2: number;

    // -----------------------------------------------------------------------
    // Moneylines → Power devig
    // Spreads/totals → Probit devig
    // -----------------------------------------------------------------------

    if (marketType === "h2h") {
      [fair1, fair2] = devigMoneylinePower([decimal1, decimal2]);
    } else {
      [fair1, fair2] = devigTwoWayProbit(decimal1, decimal2);
    }

    weightedFair1 += fair1 * weight;
    weightedFair2 += fair2 * weight;
  }

  return {
    consensus1: weightedFair1,
    consensus2: weightedFair2,
  };
}

// ============================================================================
// EV & KELLY SIZING
// ============================================================================

export function calculateEV(fairProb: number, price: number): number | null {
  if (fairProb <= 0) return null;
  return (fairProb - price) / fairProb;
}

/**
 * Calculate Kelly Criterion bet size
 */
export function calculateKellySize(
  fairProb: number,
  price: number,
  bankrollUSD: number,
  currentMarketExposureUSD: number,
  currentBucketExposureUSD: number,
): KellySize {
  const edge = fairProb - price;

  // Kelly fraction for prediction markets
  const rawKellyFraction = edge / (1 - price);

  // Apply fractional Kelly
  const kellyFraction = rawKellyFraction * KELLY_MULTIPLIER;

  // Raw unconstrained sizing
  const rawKellySizeUSD = bankrollUSD * kellyFraction;
  const rawKellyShares = rawKellySizeUSD / price;

  // Hard risk caps
  const maxPerMarketUSD = bankrollUSD * MAX_PER_MARKET_FRACTION;
  const maxPerBucketUSD = bankrollUSD * MAX_PER_BUCKET_FRACTION;

  // Remaining capacity
  const remainingMarketRoomUSD = maxPerMarketUSD - currentMarketExposureUSD;

  const remainingBucketRoomUSD = maxPerBucketUSD - currentBucketExposureUSD;

  // Start with raw Kelly size
  let constrainedSizeUSD = rawKellySizeUSD;
  let limitingFactor: KellySize["limitingFactor"] = "kelly";

  // Apply market cap
  if (remainingMarketRoomUSD < constrainedSizeUSD) {
    constrainedSizeUSD = remainingMarketRoomUSD;
    limitingFactor = "market-cap";
  }

  // Apply bucket cap
  if (remainingBucketRoomUSD < constrainedSizeUSD) {
    constrainedSizeUSD = remainingBucketRoomUSD;
    limitingFactor = "bucket-cap";
  }

  // Never negative
  constrainedSizeUSD = Math.max(0, constrainedSizeUSD);

  const constrainedShares = constrainedSizeUSD / price;

  // Stored as fraction (0.04 = 4%)
  const bankrollPct = constrainedSizeUSD / bankrollUSD;

  return {
    edge,
    kellyFraction,
    rawKellySizeUSD,
    rawKellyShares,
    constrainedSizeUSD,
    constrainedShares,
    limitingFactor,
    bankrollPct,
  };
}

// ============================================================================
// MAKER STRATEGY HELPERS
// ============================================================================
/**
 * Get maker margin range for market type
 */
export function getMarginRange(marketType: MarketType): {
  min: number;
  max: number;
} {
  return MAKER_MARGINS[marketType];
}

/**
 * Get taker minimum EV threshold
 */
export function getTakerMinimum(marketType: MarketType): number {
  return TAKER_MARGINS[marketType];
}

/**
 * Round price to whole percentage points
 */
export function roundToWholePercent(
  price: number,
  direction: "up" | "down",
): number {
  if (direction === "up") {
    return Math.min(0.99, Math.ceil(price * 100) / 100);
  }

  return Math.max(0.01, Math.floor(price * 100) / 100);
}
