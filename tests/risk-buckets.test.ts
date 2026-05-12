import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeBucketPart,
  getCorrelationBucketKey,
} from "../src/arb/risk-buckets.js";
import type { PolymarketMarket } from "../src/types.js";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeMarket(overrides: Partial<PolymarketMarket>): PolymarketMarket {
  return {
    // marketId: "test-id",
    conditionId: "0xabc",
    marketSlug: "bills-chiefs-ml",
    eventSlug: "bills-vs-chiefs-2024-01-21",
    eventTitle: "Buffalo Bills vs Kansas City Chiefs",
    marketQuestion: "Will the Buffalo Bills win?",
    sport: "nfl",
    marketType: "h2h",
    startTime: "2024-01-21T18:00:00Z",
    homeTeam: "Buffalo Bills",
    awayTeam: "Kansas City Chiefs",
    tokenId1: "111",
    tokenId2: "222",
    negRisk: false,
    tickSize: 0.01,
    minOrderSize: 5,
    liquidity: 10000,
    outcome1Name: "Buffalo Bills",
    outcome2Name: "Kansas City Chiefs",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// normalizeBucketPart
// ---------------------------------------------------------------------------

describe("normalizeBucketPart", () => {
  it("lowercases and hyphenates team names", () => {
    assert.equal(normalizeBucketPart("Buffalo Bills"), "buffalo-bills");
  });

  it("strips punctuation", () => {
    assert.equal(
      normalizeBucketPart("Kansas City Chiefs!"),
      "kansas-city-chiefs",
    );
  });

  it("collapses multiple spaces", () => {
    assert.equal(
      normalizeBucketPart("New  England  Patriots"),
      "new-england-patriots",
    );
  });

  it("handles already normalized input", () => {
    assert.equal(normalizeBucketPart("golden-state"), "golden-state");
  });
});

// ---------------------------------------------------------------------------
// getCorrelationBucketKey
// ---------------------------------------------------------------------------

describe("getCorrelationBucketKey", () => {
  it("h2h outcome 1 includes team name and full scope", () => {
    const market = makeMarket({ marketType: "h2h" });
    const key = getCorrelationBucketKey(market, 1);
    assert.equal(
      key,
      "event:bills-vs-chiefs-2024-01-21:scope:full:side:buffalo-bills",
    );
  });

  it("h2h outcome 2 uses the other team name", () => {
    const market = makeMarket({ marketType: "h2h" });
    const key = getCorrelationBucketKey(market, 2);
    assert.equal(
      key,
      "event:bills-vs-chiefs-2024-01-21:scope:full:side:kansas-city-chiefs",
    );
  });

  it("spreads outcome 1 shares bucket with h2h outcome 1 (same side, same event)", () => {
    const h2h = makeMarket({ marketType: "h2h" });
    const spread = makeMarket({
      marketType: "spreads",
      marketSlug: "bills-chiefs-spread",
    });
    assert.equal(
      getCorrelationBucketKey(h2h, 1),
      getCorrelationBucketKey(spread, 1),
      "Bills ML and Bills -3 should share a bucket",
    );
  });

  it("totals uses total bucket regardless of outcome", () => {
    const market = makeMarket({ marketType: "totals" });
    const key1 = getCorrelationBucketKey(market, 1);
    const key2 = getCorrelationBucketKey(market, 2);
    assert.ok(key1.endsWith(":total"));
    assert.equal(key1, key2);
  });

  it("totals bucket is different from h2h bucket", () => {
    const h2h = makeMarket({ marketType: "h2h" });
    const total = makeMarket({ marketType: "totals" });
    assert.notEqual(
      getCorrelationBucketKey(h2h, 1),
      getCorrelationBucketKey(total, 1),
    );
  });

  it("h1 markets use h1 scope", () => {
    const market = makeMarket({ marketType: "h2h_h1" });
    const key = getCorrelationBucketKey(market, 1);
    assert.ok(key.includes(":scope:h1:"));
  });

  it("h1 and full markets are in different buckets", () => {
    const full = makeMarket({ marketType: "h2h" });
    const h1 = makeMarket({ marketType: "h2h_h1" });
    assert.notEqual(
      getCorrelationBucketKey(full, 1),
      getCorrelationBucketKey(h1, 1),
    );
  });

  it("totals_h1 uses h1 scope and total suffix", () => {
    const market = makeMarket({ marketType: "totals_h1" });
    const key = getCorrelationBucketKey(market, 1);
    assert.equal(key, "event:bills-vs-chiefs-2024-01-21:scope:h1:total");
  });
});
