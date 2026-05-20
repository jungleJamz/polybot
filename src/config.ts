import "dotenv/config";
import { log } from "./logger.js";
import { privateKeyToAccount } from "viem/accounts";
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRequired(name: string): string {
  const value = process.env[name];

  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value.trim();
}

function getOptional(name: string, fallback: string): string {
  const value = process.env[name];

  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  return value.trim();
}

function getBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();

  if (value === undefined || value === "") {
    return fallback;
  }

  if (value === "true") return true;
  if (value === "false") return false;

  // console.warn(
  //   `[config] ${name}="${value}" is invalid, using fallback=${fallback}`,
  // );
  log.warn(
    `[config] ${name}="${value}" is not a valid boolean, using fallback=${fallback}`,
  );

  return fallback;
}

function getNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;

  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name}="${raw}" is not a valid number`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// REQUIRED SECRETS (fail fast if missing)
// ---------------------------------------------------------------------------

const rawKey = getRequired("POLY_PRIVATE_KEY");
const stripped = rawKey.startsWith("0x") ? rawKey.slice(2) : rawKey;

if (!/^[0-9a-fA-F]{64}$/.test(stripped)) {
  throw new Error(
    `POLY_PRIVATE_KEY must be a 64-character hex string (with or without 0x prefix)`,
  );
}

const POLY_PRIVATE_KEY = `0x${stripped}`;
const POLY_ADDRESS = privateKeyToAccount(POLY_PRIVATE_KEY as `0x${string}`).address;


const ODDS_API_KEY = getRequired("ODDS_API_KEY");

const BANKROLL_USD = Number(getRequired("BANKROLL_USD"));

if (!Number.isFinite(BANKROLL_USD) || BANKROLL_USD <= 0) {
  throw new Error(
    `BANKROLL_USD must be a positive number, got "${process.env.BANKROLL_USD}"`,
  );
}

// ---------------------------------------------------------------------------
// Environment config
// ---------------------------------------------------------------------------

export const env = {
  polyPrivateKey: POLY_PRIVATE_KEY,
  polyAddress: POLY_ADDRESS,
  oddsApiKey: ODDS_API_KEY,

  bankrollUSD: BANKROLL_USD,

  polySignatureType: getNumber("POLY_SIGNATURE_TYPE", 3),

  dryRun: getBoolean("DRY_RUN", true),
  verbose: getBoolean("VERBOSE", false),
  logUnmatchedLines: getBoolean("LOG_UNMATCHED_LINES", false),

  clobApiUrl: getOptional("CLOB_API_URL", "https://clob.polymarket.com"),

  dataApiUrl: getOptional(
    "POLYMARKET_DATA_API_URL",
    "https://data-api.polymarket.com",
  ),

  pollingIntervalMs: getNumber("POLLING_INTERVAL_MS", 1000),

  marginAdjustment: getNumber("MARGIN_ADJUSTMENT", 0),
};

// ---------------------------------------------------------------------------
// BOOKMAKERS
// Single source of truth: weights.
// ---------------------------------------------------------------------------

export const BOOKMAKER_WEIGHTS = {
  // Tier 1 — sharp books
  pinnacle: 0.44,
  marathonbet: 0.15,
  betonlineag: 0.1,
  betanysports: 0.07,

  // Tier 2 — US recreational
  draftkings: 0.1,
  fanduel: 0.07,

  // Tier 3 — regional coverage
  unibet_uk: 0.04,
  sport888: 0.03,
} as const;

export const BOOKMAKERS = Object.keys(BOOKMAKER_WEIGHTS);

// ---------------------------------------------------------------------------
// MARGIN THRESHOLDS (by market type)
//
// Maker margins: { min, max } — post a maker bid only when implied edge
// falls in this band. The MAX is outlier protection: if devig says we have
// 15% edge, the realistic explanation is stale data or matcher error, NOT
// free money — so we skip rather than place a too-good-to-be-true order.
//
// Taker margins: single threshold — minimum edge required to cross the
// spread and hit the ask. Higher than maker min because takers pay the
// spread instead of earning it.
//
// First-half markets (_h1) get higher floors: more variance + less
// reliable fair-value estimates.
//
// All thresholds shift by env.marginAdjustment (default 0). Use this
// to tighten on volatile days (e.g., NFL Sundays) without redeploying.
// ---------------------------------------------------------------------------

const ADJ = env.marginAdjustment;

export const MAKER_MARGINS = {
  h2h: { min: 0.03 + ADJ, max: 0.08 + ADJ },
  spreads: { min: 0.04 + ADJ, max: 0.09 + ADJ },
  totals: { min: 0.07 + ADJ, max: 0.11 + ADJ },
  h2h_h1: { min: 0.06 + ADJ, max: 0.12 + ADJ },
  spreads_h1: { min: 0.06 + ADJ, max: 0.12 + ADJ },
  totals_h1: { min: 0.06 + ADJ, max: 0.12 + ADJ },
} as const;

// Improvement #1 from PROGRESS.md: takers raised to 8% / 10% (1H).
// Reference had 6% / 10%; data showed 4-6% taker EV was negative CLV
// on NBA coin-flips.
export const TAKER_MARGINS = {
  h2h: 0.08 + ADJ,
  spreads: 0.08 + ADJ,
  totals: 0.08 + ADJ,
  h2h_h1: 0.1 + ADJ,
  spreads_h1: 0.1 + ADJ,
  totals_h1: 0.1 + ADJ,
} as const;

export const TAKER_MIN_BOOKMAKERS = 4;

export type MarketType = keyof typeof MAKER_MARGINS;

// ---------------------------------------------------------------------------
// POSITION SIZING (Kelly + risk caps)
//
// Kelly multiplier scales raw Kelly size. Full Kelly maximizes long-run
// growth IF your edge estimate is exact. Real edge estimates are noisy
// (devig errors, matcher errors, slippage), and overestimated edge at
// full Kelly produces ruinous drawdowns. Fractional Kelly trades growth
// for stability.
//
// Reference uses 0.40. We're starting at 0.25 — devig and matcher are
// unvalidated in this rebuild, conservative until we measure actual CLV.
// Raise after we have data; never raise mid-drawdown.
//
// Per-market cap: hard ceiling regardless of Kelly. Caps single-event
// blowup risk (referee call, injury, weather).
//
// Per-bucket cap: caps correlated exposure across all markets on the
// same underlying event (Bills ML + Bills -3 + over 51 are correlated).
// Without this, Kelly could load 4% × 5 markets = 20% on one game.
// ---------------------------------------------------------------------------

export const KELLY_MULTIPLIER = 0.25;
export const MAX_PER_MARKET_FRACTION = 0.04; // 4% of bankroll, single market
export const MAX_PER_BUCKET_FRACTION = 0.07; // 7% of bankroll, correlation bucket

// ---------------------------------------------------------------------------
// MAKER ORDER LIFECYCLE
// Maker orders sit on the book waiting to be hit. While they wait, the
// world moves: sportsbook lines shift, news drops, injuries get reported.
// A maker bid that had +5% EV at placement might be -1% EV ten seconds
// later. MAKER_EVAL_EV_DROP is the cancel trigger.
// Trade-off:
// too tight (0.5%): cancel/replace constantly, lose queue priority
// too loose (5.0%): hold stale orders that fill at bad prices
// MAKER_STRATEGY:
//   "incremental" → post at best-bid + 1¢ (maximizes fill probability)
//   "target"      → post at fair-minus-margin (maximizes profit per fill)
// Reference uses incremental and earned +1.54% CLV doing it.
// ---------------------------------------------------------------------------
export const MAKER_EVAL_EV_DROP = 0.02;
export const MAKER_STRATEGY: "incremental" | "target" = "incremental";

// ---------------------------------------------------------------------------
// HOURS_AHEAD: only consider markets with games starting within this
// window. The Odds API has freshest pricing for soon-to-start games;
// markets days out have stale or thin lines.
// CLV_UPDATE_WINDOW_MS: how long before kickoff to start updating CLV.
// Closing-line value is the gold-standard noise-resistant proxy for
// edge — "did you bet at a better price than where the line closed?"
// If yes consistently, you have edge, even if individual bets lose.

// ---------------------------------------------------------------------------
export const HOURS_AHEAD = 24;

export const CLV_UPDATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
// ---------------------------------------------------------------------------
// SPORT_MAP — Polymarket short codes → The Odds API sport keys
// Starting narrow. NFL has best historical CLV (+6.22%), NBA second.
// Expand once matcher + analyzer are validated end-to-end.
// ---------------------------------------------------------------------------

export const SPORT_MAP = {
  nfl: "americanfootball_nfl",
  // cfb:  "americanfootball_ncaaf",
  nba: "basketball_nba",
  // ncaab: "basketball_ncaab",
  // wnba: "basketball_wnba",
  nhl: "icehockey_nhl",
  mlb: "baseball_mlb",
  // epl:  "soccer_epl",
} as const;

export type SportCode = keyof typeof SPORT_MAP;
// ---------------------------------------------------------------------------
// Startup validation
// ---------------------------------------------------------------------------

export function validateEnv(): void {
  // ---------------------------------------------------------------------------
  // 1. bookmaker weights must sum to 1.0
  // ---------------------------------------------------------------------------
  const totalWeight = Object.values(BOOKMAKER_WEIGHTS).reduce(
    (sum, weight) => sum + weight,
    0,
  );

  if (Math.abs(totalWeight - 1) > 0.001) {
    throw new Error(`BOOKMAKER_WEIGHTS sum to ${totalWeight}, must equal 1.0`);
  }

  // ---------------------------------------------------------------------------
  // 2. polling floor safety check
  // ---------------------------------------------------------------------------
  if (env.pollingIntervalMs < 500) {
    throw new Error(
      `POLLING_INTERVAL_MS=${env.pollingIntervalMs} below 500ms minimum`,
    );
  }

  // ---------------------------------------------------------------------------
  // 3. margin adjustment sanity check
  // ---------------------------------------------------------------------------
  if (Math.abs(env.marginAdjustment) > 0.05) {
    throw new Error(
      `MARGIN_ADJUSTMENT=${env.marginAdjustment} outside ±0.05 safety range`,
    );
  }

  // ---------------------------------------------------------------------------
  // 4. taker vs maker consistency
  // ---------------------------------------------------------------------------
  for (const type of Object.keys(TAKER_MARGINS) as MarketType[]) {
    const takerMin = TAKER_MARGINS[type];
    const makerMin = MAKER_MARGINS[type].min;

    if (takerMin < makerMin) {
      throw new Error(
        `TAKER_MARGINS.${type}=${takerMin} must be >= MAKER_MARGINS.${type}.min=${makerMin}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // 5. risk caps sanity check
  // ---------------------------------------------------------------------------
  if (MAX_PER_MARKET_FRACTION >= MAX_PER_BUCKET_FRACTION) {
    throw new Error(
      `MAX_PER_MARKET_FRACTION=${MAX_PER_MARKET_FRACTION} must be < MAX_PER_BUCKET_FRACTION=${MAX_PER_BUCKET_FRACTION}`,
    );
  }

  if (MAX_PER_MARKET_FRACTION <= 0 || MAX_PER_MARKET_FRACTION > 0.1) {
    throw new Error(
      `MAX_PER_MARKET_FRACTION=${MAX_PER_MARKET_FRACTION} outside (0, 0.1] safety range`,
    );
  }

  // ---------------------------------------------------------------------------
  // 6. Kelly sanity check
  // ---------------------------------------------------------------------------
  if (KELLY_MULTIPLIER <= 0 || KELLY_MULTIPLIER > 1) {
    throw new Error(`KELLY_MULTIPLIER=${KELLY_MULTIPLIER} must be in (0, 1]`);
  }

  if (MAKER_EVAL_EV_DROP <= 0 || MAKER_EVAL_EV_DROP > 0.1) {
    throw new Error(
      `MAKER_EVAL_EV_DROP=${MAKER_EVAL_EV_DROP} outside (0, 0.1] safety range`,
    );
  }
}
