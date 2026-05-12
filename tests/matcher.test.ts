import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { matchMarkets } from "../src/arb/matcher.js";
import type { PolymarketMarket, OddsAPIEvent } from "../src/types.js";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeMarket(
  overrides: Partial<PolymarketMarket> = {},
): PolymarketMarket {
  return {
    // marketId: "test-id",
    conditionId: "0xabc",
    marketSlug: "bills-chiefs-ml",
    eventSlug: "bills-vs-chiefs",
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

function makeOddsEvent(overrides: Partial<OddsAPIEvent> = {}): OddsAPIEvent {
  return {
    id: "event-123",
    sport_key: "americanfootball_nfl",
    sport_title: "NFL",
    commence_time: "2024-01-21T18:00:00Z",
    home_team: "Buffalo Bills",
    away_team: "Kansas City Chiefs",
    bookmakers: [
      {
        key: "pinnacle",
        title: "Pinnacle",
        last_update: "2024-01-21T12:00:00Z",
        markets: [
          {
            key: "h2h",
            last_update: "2024-01-21T12:00:00Z",
            outcomes: [
              { name: "Buffalo Bills", price: -110 },
              { name: "Kansas City Chiefs", price: -110 },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Team matching
// ---------------------------------------------------------------------------

describe("matchMarkets — team matching", () => {
  it("matches exact team names", () => {
    const market = makeMarket();
    const event = makeOddsEvent();
    const [result] = matchMarkets([market], { nfl: [event] });
    assert.ok(result);
    assert.ok(!result.skipReason, `unexpected skip: ${result.skipReason}`);
    assert.ok("pinnacle" in result.sportsbooks);
  });

  it("matches when Polymarket and Odds API have home/away swapped", () => {
    const market = makeMarket({
      homeTeam: "Buffalo Bills",
      awayTeam: "Kansas City Chiefs",
    });
    const event = makeOddsEvent({
      home_team: "Kansas City Chiefs",
      away_team: "Buffalo Bills",
    });
    const [result] = matchMarkets([market], { nfl: [event] });
    assert.ok(
      !result.skipReason,
      `should match reversed: ${result.skipReason}`,
    );
  });

  it("matches partial team names (Bills vs Buffalo Bills)", () => {
    const market = makeMarket({ homeTeam: "Bills" });
    const event = makeOddsEvent({ home_team: "Buffalo Bills" });
    const [result] = matchMarkets([market], { nfl: [event] });
    assert.ok(!result.skipReason, `should fuzzy match: ${result.skipReason}`);
  });

  it("skips when no matching event found", () => {
    const market = makeMarket({
      homeTeam: "Dallas Cowboys",
      awayTeam: "New York Giants",
    });
    const event = makeOddsEvent(); // Bills vs Chiefs
    const [result] = matchMarkets([market], { nfl: [event] });
    assert.equal(result.skipReason, "Event not found in sportsbooks");
  });

  it("skips when market has no team names", () => {
    const market = makeMarket({ homeTeam: undefined, awayTeam: undefined });
    const [result] = matchMarkets([market], { nfl: [] });
    assert.equal(result.skipReason, "No team names");
  });

  it("returns empty results for empty market list", () => {
    const results = matchMarkets([], { nfl: [] });
    assert.equal(results.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Spread line matching
// ---------------------------------------------------------------------------

describe("matchMarkets — spread line matching", () => {
  function makeSpreadEvent(line: number): OddsAPIEvent {
    return makeOddsEvent({
      bookmakers: [
        {
          key: "pinnacle",
          title: "Pinnacle",
          last_update: "2024-01-21T12:00:00Z",
          markets: [
            {
              key: "spreads",
              last_update: "2024-01-21T12:00:00Z",
              outcomes: [
                { name: "Buffalo Bills", price: -110, point: line },
                { name: "Kansas City Chiefs", price: -110, point: -line },
              ],
            },
          ],
        },
      ],
    });
  }

  it("matches when spread line exactly matches", () => {
    const market = makeMarket({
      marketType: "spreads",
      marketQuestion: "Bills spread (-3.5)",
    });
    const event = makeSpreadEvent(3.5);
    const [result] = matchMarkets([market], { nfl: [event] });
    assert.ok(!result.skipReason, `unexpected skip: ${result.skipReason}`);
    assert.ok("pinnacle" in result.sportsbooks);
  });

  it("skips when spread line does not match", () => {
    const market = makeMarket({
      marketType: "spreads",
      marketQuestion: "Bills spread (-7.5)",
    });
    const event = makeSpreadEvent(3.5); // book has -3.5, not -7.5
    const [result] = matchMarkets([market], { nfl: [event] });
    assert.ok(
      result.skipReason?.includes("7.5"),
      `expected line mismatch: ${result.skipReason}`,
    );
  });

  it("skips when spread line cannot be extracted from question", () => {
    const market = makeMarket({
      marketType: "spreads",
      marketQuestion: "Will the Bills cover?", // no line in text
    });
    const event = makeSpreadEvent(3.5);
    const [result] = matchMarkets([market], { nfl: [event] });
    assert.ok(
      result.skipReason?.includes("extract"),
      `expected extract error: ${result.skipReason}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Totals line matching
// ---------------------------------------------------------------------------

describe("matchMarkets — totals line matching", () => {
  function makeTotalsEvent(line: number): OddsAPIEvent {
    return makeOddsEvent({
      bookmakers: [
        {
          key: "pinnacle",
          title: "Pinnacle",
          last_update: "2024-01-21T12:00:00Z",
          markets: [
            {
              key: "totals",
              last_update: "2024-01-21T12:00:00Z",
              outcomes: [
                { name: "Over", price: -110, point: line },
                { name: "Under", price: -110, point: line },
              ],
            },
          ],
        },
      ],
    });
  }

  it("matches when total line exactly matches", () => {
    const market = makeMarket({
      marketType: "totals",
      marketQuestion: "Will total points be o/u 47.5?",
    });
    const event = makeTotalsEvent(47.5);
    const [result] = matchMarkets([market], { nfl: [event] });
    assert.ok(!result.skipReason, `unexpected skip: ${result.skipReason}`);
  });

  it("skips when total line does not match", () => {
    const market = makeMarket({
      marketType: "totals",
      marketQuestion: "Will total points be o/u 51.5?",
    });
    const event = makeTotalsEvent(47.5);
    const [result] = matchMarkets([market], { nfl: [event] });
    assert.ok(
      result.skipReason?.includes("51.5"),
      `expected line mismatch: ${result.skipReason}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Sport isolation
// ---------------------------------------------------------------------------

describe("matchMarkets — sport isolation", () => {
  it("does not match NFL markets against NBA events", () => {
    const market = makeMarket({ sport: "nfl" });
    const nbaEvent = makeOddsEvent(); // same team names but wrong sport
    const [result] = matchMarkets([market], { nba: [nbaEvent] });
    assert.equal(result.skipReason, "Event not found in sportsbooks");
  });

  it("matches multiple sports in one call", () => {
    const nflMarket = makeMarket({ sport: "nfl" });
    const nbaMarket = makeMarket({
      sport: "nba",
      // marketId: "2",
      homeTeam: "Lakers",
      awayTeam: "Celtics",
      outcome1Name: "Lakers",
      outcome2Name: "Celtics",
    });
    const nbaEvent = makeOddsEvent({
      sport_key: "basketball_nba",
      home_team: "Lakers",
      away_team: "Celtics",
    });
    const results = matchMarkets([nflMarket, nbaMarket], {
      nfl: [makeOddsEvent()],
      nba: [nbaEvent],
    });
    assert.equal(results.length, 2);
    assert.ok(!results[0]?.skipReason);
    assert.ok(!results[1]?.skipReason);
  });
});

// ---------------------------------------------------------------------------
// Bookmaker filtering
// ---------------------------------------------------------------------------

describe("matchMarkets — bookmaker filtering", () => {
  it("only includes known bookmakers", () => {
    const market = makeMarket();
    const event = makeOddsEvent({
      bookmakers: [
        {
          key: "pinnacle",
          title: "Pinnacle",
          last_update: "2024-01-21T12:00:00Z",
          markets: [
            {
              key: "h2h",
              last_update: "2024-01-21T12:00:00Z",
              outcomes: [
                { name: "Buffalo Bills", price: -110 },
                { name: "Kansas City Chiefs", price: -110 },
              ],
            },
          ],
        },
        {
          key: "some_unknown_book",
          title: "Unknown",
          last_update: "2024-01-21T12:00:00Z",
          markets: [],
        },
      ],
    });
    const [result] = matchMarkets([market], { nfl: [event] });
    assert.ok("pinnacle" in result.sportsbooks);
    assert.ok(!("some_unknown_book" in result.sportsbooks));
  });
});
