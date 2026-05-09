import { describe, it } from "node:test";
  import assert from "node:assert/strict";

  import {
    americanToDecimal,
    decimalToImpliedProb,
    devigMoneylinePower,
    devigTwoWayProbit,
    calculateWeightedConsensus,
    calculateEV,
    calculateKellySize,
    getMarginRange,
    getTakerMinimum,
    roundToWholePercent,
  } from "../src/arb/calculator.js";

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------

  // Float comparison with tolerance — required for all probability math
  function near(actual: number, expected: number, tol = 0.0001): boolean {
    return Math.abs(actual - expected) <= tol;
  }

  // ---------------------------------------------------------------------------
  // Odds conversion
  // ---------------------------------------------------------------------------

  describe("americanToDecimal", () => {
    it("converts positive American odds", () => {
      // +200 means win $200 on $100 bet → decimal 3.0
      assert.ok(near(americanToDecimal(200), 3.0));
    });

    it("converts negative American odds", () => {
      // -110 means bet $110 to win $100 → decimal 1.909
      assert.ok(near(americanToDecimal(-110), 1.9091, 0.001));
    });

    it("converts -100 (even money)", () => {
      assert.ok(near(americanToDecimal(-100), 2.0));
    });

    it("converts +100 (even money)", () => {
      assert.ok(near(americanToDecimal(100), 2.0));
    });
  });

  describe("decimalToImpliedProb", () => {
    it("converts decimal 2.0 to 0.5", () => {
      assert.ok(near(decimalToImpliedProb(2.0), 0.5));
    });

    it("converts decimal 1.909 to ~0.524", () => {
      assert.ok(near(decimalToImpliedProb(1.9091), 0.524, 0.001));
    });
  });

  // ---------------------------------------------------------------------------
  // De-vigging — Power (moneylines)
  // ---------------------------------------------------------------------------

  describe("devigMoneylinePower", () => {
    it("returns probabilities that sum to 1.0", () => {
      // Pinnacle -110 / -110 (4.8% vig)
      const decimal1 = americanToDecimal(-110);
      const decimal2 = americanToDecimal(-110);
      const [p1, p2] = devigMoneylinePower([decimal1, decimal2]);
      assert.ok(near(p1 + p2, 1.0), `sum=${p1 + p2}`);
    });

    it("produces 0.5/0.5 for a perfectly symmetric market", () => {
      // Equal odds both sides — no favorite-longshot bias to correct
      const [p1, p2] = devigMoneylinePower([2.0, 2.0]);
      assert.ok(near(p1, 0.5));
      assert.ok(near(p2, 0.5));
    });

    it("correctly adjusts for favorite-longshot bias", () => {
      // Heavy favorite -300 / underdog +250
      // Proportional would give favorite 0.75/1.167 = 0.643
      // Power method should give favorite a LOWER probability (bias correction)
      const fav = americanToDecimal(-300);
      const dog = americanToDecimal(250);
      const [pFav, pDog] = devigMoneylinePower([fav, dog]);
      const proportional = (1 / fav) / ((1 / fav) + (1 / dog));
      assert.ok(pFav > proportional, "power should raise favorite vs proportional (longshot bias)");
      assert.ok(near(pFav + pDog, 1.0));
    });

    it("handles already-fair odds (no vig)", () => {
      const [p1, p2] = devigMoneylinePower([2.0, 2.0]);
      assert.ok(near(p1, 0.5));
      assert.ok(near(p2, 0.5));
    });
  });

  // ---------------------------------------------------------------------------
  // De-vigging — Probit (spreads/totals)
  // ---------------------------------------------------------------------------

  describe("devigTwoWayProbit", () => {
    it("returns probabilities that sum to 1.0", () => {
      const d1 = americanToDecimal(-110);
      const d2 = americanToDecimal(-110);
      const [p1, p2] = devigTwoWayProbit(d1, d2);
      assert.ok(near(p1 + p2, 1.0), `sum=${p1 + p2}`);
    });

    it("produces 0.5/0.5 for symmetric -110/-110", () => {
      // Spread markets with equal vig on both sides → exactly 50/50 after devig
      const d1 = americanToDecimal(-110);
      const d2 = americanToDecimal(-110);
      const [p1, p2] = devigTwoWayProbit(d1, d2);
      assert.ok(near(p1, 0.5, 0.001));
      assert.ok(near(p2, 0.5, 0.001));
    });

    it("handles slight asymmetry", () => {
      // -115 / -105 — slight lean to one side
      const d1 = americanToDecimal(-115);
      const d2 = americanToDecimal(-105);
      const [p1, p2] = devigTwoWayProbit(d1, d2);
      assert.ok(near(p1 + p2, 1.0));
      assert.ok(p1 > 0.5, "heavier side should have higher probability");
    });
  });

  // ---------------------------------------------------------------------------
  // Weighted consensus
  // ---------------------------------------------------------------------------

  describe("calculateWeightedConsensus", () => {
    it("returns null for empty bookmaker list", () => {
      const result = calculateWeightedConsensus([], "h2h");
      assert.equal(result, null);
    });

    it("returns null when no bookmaker weights match", () => {
      const result = calculateWeightedConsensus(
        [{ bookmaker: "unknown_book", outcome1Price: -110, outcome2Price: -110 }],
        "h2h"
      );
      assert.equal(result, null);
    });

    it("consensus sums to ~1.0 with a single sharp book", () => {
      const result = calculateWeightedConsensus(
        [{ bookmaker: "pinnacle", outcome1Price: -110, outcome2Price: -110 }],
        "h2h"
      );
      assert.ok(result !== null);
      assert.ok(near(result.consensus1 + result.consensus2, 1.0));
    });

    it("consensus sums to ~1.0 with multiple books", () => {
      const result = calculateWeightedConsensus(
        [
          { bookmaker: "pinnacle",    outcome1Price: -108, outcome2Price: -112 },
          { bookmaker: "draftkings",  outcome1Price: -110, outcome2Price: -110 },
          { bookmaker: "fanduel",     outcome1Price: -112, outcome2Price: -108 },
        ],
        "h2h"
      );
      assert.ok(result !== null);
      assert.ok(near(result.consensus1 + result.consensus2, 1.0));
    });

    it("uses probit for spreads (not power)", () => {
      // For a symmetric spread, consensus should be very close to 0.5/0.5
      const result = calculateWeightedConsensus(
        [{ bookmaker: "pinnacle", outcome1Price: -110, outcome2Price: -110 }],
        "spreads"
      );
      assert.ok(result !== null);
      assert.ok(near(result.consensus1, 0.5, 0.001));
      assert.ok(near(result.consensus2, 0.5, 0.001));
    });
  });

  // ---------------------------------------------------------------------------
  // EV
  // ---------------------------------------------------------------------------

  describe("calculateEV", () => {
    it("returns positive EV when price is below fair value", () => {
      // Fair prob 0.55, price 0.50 → EV = (0.55 - 0.50) / 0.55 = 9.09%
      const ev = calculateEV(0.55, 0.50);
      assert.ok(ev !== null);
      assert.ok(near(ev, 0.0909, 0.001));
    });

    it("returns negative EV when price is above fair value", () => {
      const ev = calculateEV(0.50, 0.55);
      assert.ok(ev !== null);
      assert.ok(ev! < 0);
    });

    it("returns zero EV when price equals fair value", () => {
      const ev = calculateEV(0.55, 0.55);
      assert.ok(ev !== null);
      assert.ok(near(ev!, 0.0));
    });

    it("returns null for zero fair probability", () => {
      const ev = calculateEV(0, 0.50);
      assert.equal(ev, null);
    });
  });

  // ---------------------------------------------------------------------------
  // Kelly sizing
  // ---------------------------------------------------------------------------

  describe("calculateKellySize", () => {
    const BANKROLL = 1000;

    it("raw Kelly fraction is edge / (1 - price)", () => {
      // fairProb=0.55, price=0.50 → raw Kelly = 0.05/0.50 = 0.10
      // × KELLY_MULTIPLIER (0.25) → 2.5% → $25
      const result = calculateKellySize(0.55, 0.50, BANKROLL, 0, 0);
      assert.ok(near(result.rawKellySizeUSD, 25, 1));
    });

    it("constrains to per-market cap (4% of bankroll = $40)", () => {
      // Kelly wants 10% ($100) but market cap is $40
      const result = calculateKellySize(0.70, 0.50, BANKROLL, 0, 0);
      assert.ok(result.constrainedSizeUSD <= BANKROLL * 0.04 + 0.01);
      assert.equal(result.limitingFactor, "market-cap");
    });

    it("constrains to bucket cap (7% of bankroll = $70)", () => {
      // Already have $40 in market, $30 in bucket — bucket has $40 room
      // Kelly wants more than $40 remaining bucket room
      const result = calculateKellySize(0.70, 0.50, BANKROLL, 40, 30);
      assert.ok(result.constrainedSizeUSD <= BANKROLL * 0.07 - 30 + 0.01);
    });

    it("returns zero when market cap is fully used", () => {
      const result = calculateKellySize(0.55, 0.50, BANKROLL, 40, 0);
      assert.ok(near(result.constrainedSizeUSD, 0));
    });

    it("bankrollPct is a fraction not a percentage", () => {
      const result = calculateKellySize(0.55, 0.50, BANKROLL, 0, 0);
      // Should be ~0.025 not ~2.5
      assert.ok(result.bankrollPct < 1, "bankrollPct should be a fraction (< 1)");
    });

    it("edge equals fairProb minus price", () => {
      const result = calculateKellySize(0.55, 0.50, BANKROLL, 0, 0);
      assert.ok(near(result.edge, 0.05));
    });
  });

  // ---------------------------------------------------------------------------
  // Margin helpers
  // ---------------------------------------------------------------------------

  describe("getMarginRange", () => {
    it("returns correct range for h2h", () => {
      const range = getMarginRange("h2h");
      assert.ok(range.min > 0);
      assert.ok(range.max > range.min);
    });

    it("h2h_h1 min is higher than h2h min (first-half is tighter)", () => {
      const h2h = getMarginRange("h2h");
      const h2hH1 = getMarginRange("h2h_h1");
      assert.ok(h2hH1.min > h2h.min);
    });
  });

  describe("getTakerMinimum", () => {
    it("returns a positive threshold for every market type", () => {
      const types = ["h2h", "spreads", "totals", "h2h_h1", "spreads_h1", "totals_h1"] as const;
      for (const t of types) {
        assert.ok(getTakerMinimum(t) > 0, `${t} taker min should be > 0`);
      }
    });

    it("h1 thresholds are higher than base thresholds", () => {
      assert.ok(getTakerMinimum("h2h_h1") > getTakerMinimum("h2h"));
      assert.ok(getTakerMinimum("totals_h1") > getTakerMinimum("totals"));
    });
  });

  describe("roundToWholePercent", () => {
    it("rounds up correctly", () => {
      assert.ok(near(roundToWholePercent(0.523, "up"), 0.53));
    });

    it("rounds down correctly", () => {
      assert.ok(near(roundToWholePercent(0.527, "down"), 0.52));
    });

    it("clamps up to 0.99 max", () => {
      assert.ok(near(roundToWholePercent(0.999, "up"), 0.99));
    });

    it("clamps down to 0.01 min", () => {
      assert.ok(near(roundToWholePercent(0.001, "down"), 0.01));
    });
  });