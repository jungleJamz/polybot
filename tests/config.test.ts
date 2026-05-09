import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import { 
    env,
    validateEnv,
    BOOKMAKER_WEIGHTS,
    MAKER_MARGINS,
    TAKER_MARGINS,
    MAX_PER_MARKET_FRACTION,
    MAX_PER_BUCKET_FRACTION,
    KELLY_MULTIPLIER,
    MAKER_EVAL_EV_DROP
} from '../src/config';

// Curent config is valid
  describe("validateEnv — happy path", () => {
    it("passes with valid .env and current constants", () => {
      assert.doesNotThrow(() => validateEnv());
    });
  });

// ---------------------------------------------------------------------------
  // Check 1 — bookmaker weights sum to 1.0
  // ---------------------------------------------------------------------------

  describe("check 1: bookmaker weight sum", () => {
    it("BOOKMAKER_WEIGHTS sums to 1.0 within tolerance", () => {
      const total = Object.values(BOOKMAKER_WEIGHTS).reduce((a, b) => a + b, 0);
      assert.ok(
        Math.abs(total - 1) <= 0.001,
        `Expected weights to sum to 1.0, got ${total}`
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Check 2 — polling interval floor
  // ---------------------------------------------------------------------------

  describe("check 2: polling interval floor", () => {
    let saved: number;

    before(() => { saved = env.pollingIntervalMs; });
    after(() => { env.pollingIntervalMs = saved; });

    it("throws when interval is below 500ms", () => {
      env.pollingIntervalMs = 400;
      assert.throws(
        () => validateEnv(),
        /below 500ms/
      );
    });

    it("accepts exactly 500ms", () => {
      env.pollingIntervalMs = 500;
      assert.doesNotThrow(() => validateEnv());
    });

    it("accepts 0 only if ... wait, it should throw", () => {
      env.pollingIntervalMs = 0;
      assert.throws(() => validateEnv(), /below 500ms/);
    });
  });

  // ---------------------------------------------------------------------------
  // Check 3 — margin adjustment safety range ±0.05
  // ---------------------------------------------------------------------------

  describe("check 3: margin adjustment bounds", () => {
    let saved: number;

    before(() => { saved = env.marginAdjustment; });
    after(() => { env.marginAdjustment = saved; });

    it("throws when adjustment is +0.06 (too high)", () => {
      env.marginAdjustment = 0.06;
      assert.throws(() => validateEnv(), /MARGIN_ADJUSTMENT/);
    });

    it("throws when adjustment is -0.06 (too low)", () => {
      env.marginAdjustment = -0.06;
      assert.throws(() => validateEnv(), /MARGIN_ADJUSTMENT/);
    });

    it("accepts 0.05 exactly (upper boundary)", () => {
      env.marginAdjustment = 0.05;
      assert.doesNotThrow(() => validateEnv());
    });

    it("accepts -0.05 exactly (lower boundary)", () => {
      env.marginAdjustment = -0.05;
      assert.doesNotThrow(() => validateEnv());
    });
  });

  // ---------------------------------------------------------------------------
  // Check 4 — taker margin must be >= maker minimum for every market type
  // ---------------------------------------------------------------------------

  describe("check 4: taker >= maker min consistency", () => {
  it("holds for every market type", () => {
    const marketTypes = Object.keys(TAKER_MARGINS) as (keyof typeof TAKER_MARGINS)[];

    for (const type of marketTypes) {
      const taker = TAKER_MARGINS[type];
      const makerMin = MAKER_MARGINS[type].min;

      assert.ok(
        taker >= makerMin,
        `${type}: taker=${taker} is below maker.min=${makerMin}`
      );
    }
  });
});

  // ---------------------------------------------------------------------------
  // Check 5 — risk cap ordering
  // ---------------------------------------------------------------------------

  describe("check 5: risk cap ordering and bounds", () => {
    it("per-market cap is less than per-bucket cap", () => {
      assert.ok(
        MAX_PER_MARKET_FRACTION < MAX_PER_BUCKET_FRACTION,
        `Expected ${MAX_PER_MARKET_FRACTION} < ${MAX_PER_BUCKET_FRACTION}`
      );
    });

    it("per-market cap is in (0, 0.10]", () => {
      assert.ok(MAX_PER_MARKET_FRACTION > 0);
      assert.ok(MAX_PER_MARKET_FRACTION <= 0.1);
    });
  });

  // ---------------------------------------------------------------------------
  // Check 6 — Kelly multiplier
  // ---------------------------------------------------------------------------

  describe("check 6: Kelly multiplier bounds", () => {
    it("KELLY_MULTIPLIER is in (0, 1]", () => {
      assert.ok(KELLY_MULTIPLIER > 0, "must be > 0");
      assert.ok(KELLY_MULTIPLIER <= 1, "must be <= 1");
    });
  });

  // ---------------------------------------------------------------------------
  // Check 7 — maker EV drop trigger
  // ---------------------------------------------------------------------------

  describe("check 7: MAKER_EVAL_EV_DROP bounds", () => {
    it("is in (0, 0.10]", () => {
      assert.ok(MAKER_EVAL_EV_DROP > 0, "must be > 0");
      assert.ok(MAKER_EVAL_EV_DROP <= 0.1, "must be <= 0.1");
    });
  });
  