import type {
  MatchedMarket,
  Opportunities,
  TakerOpportunity,
  MakerOpportunity,
  MarketType,
  PolymarketMarket,
} from "../types.js";
import {
  calculateWeightedConsensus,
  calculateEV,
  calculateKellySize,
  getMarginRange,
  getTakerMinimum,
  roundToWholePercent,
} from "./calculator.js";
import { MAKER_STRATEGY } from "../config.js";
import { getCorrelationBucketKey } from "./risk-buckets.js";
import { normalizeTeam } from "../utils.js";

// extractLine stays private here (same as matcher, not worth exporting). makerMarketType remaps "player_props" to "totals" so margin lookups work — player props are Over/Under bets and share totals' risk profile.
function extractLine(question: string, marketType: string): number | null {
  if (marketType === "totals" || marketType === "totals_h1") {
    const m = question.match(/o\/u\s+(\d+\.?\d*)/i);
    return m?.[1] ? parseFloat(m[1]) : null;
  }
  if (marketType === "spreads" || marketType === "spreads_h1") {
    const m = question.match(/\(([+-]?\d+\.?\d*)\)/);
    return m?.[1] ? parseFloat(m[1]) : null;
  }
  return null;
}

// player_props use totals-style devigging and margin thresholds
function makerMarketType(type: PolymarketMarket["marketType"]): MarketType {
  return type === "player_props" ? "totals" : type;
}

// extract bookmaker odds
function calculateMarketEV(
  match: MatchedMarket,
  totalCapitalUsd: number,
): void {
  const pm = match.polymarket;
  const bookmakers = Object.keys(match.sportsbooks);
  if (bookmakers.length === 0) return;

  const pmLine = extractLine(pm.marketQuestion, pm.marketType);

  const bookmakerOdds: Array<{
    bookmaker: string;
    outcome1Price: number;
    outcome2Price: number;
  }> = [];

  for (const bookKey of bookmakers) {
    const bookData = match.sportsbooks[bookKey];
    if (!bookData) continue;

    let outcome1Price: number | null = null;
    let outcome2Price: number | null = null;

    for (const outcome of bookData.market.outcomes) {
      if (pm.marketType === "player_props") {
        if (
          pm.playerLine !== undefined &&
          pm.playerName &&
          outcome.point !== undefined &&
          outcome.description &&
          Math.abs(outcome.point - pm.playerLine) < 0.01
        ) {
          const pmPlayer = normalizeTeam(pm.playerName);
          const oddsPlayer = normalizeTeam(outcome.description);
          const playerMatch =
            pmPlayer === oddsPlayer ||
            pmPlayer.includes(oddsPlayer) ||
            oddsPlayer.includes(pmPlayer);

          if (playerMatch) {
            const name = outcome.name.toLowerCase();
            if (name === "over") outcome1Price = outcome.price;
            else if (name === "under") outcome2Price = outcome.price;
          }
        }
      } else if (
        pm.marketType === "spreads" ||
        pm.marketType === "spreads_h1"
      ) {
        if (pmLine !== null && outcome.point !== undefined) {
          if (
            pm.outcome1Name &&
            teamsMatch(pm.outcome1Name, outcome.name) &&
            Math.abs(outcome.point - pmLine) < 0.01
          ) {
            outcome1Price = outcome.price;
          } else if (
            pm.outcome2Name &&
            teamsMatch(pm.outcome2Name, outcome.name) &&
            Math.abs(outcome.point + pmLine) < 0.01
          ) {
            outcome2Price = outcome.price;
          }
        }
      } else if (pm.marketType === "totals" || pm.marketType === "totals_h1") {
        if (
          pmLine !== null &&
          outcome.point !== undefined &&
          Math.abs(outcome.point - pmLine) < 0.01
        ) {
          if (
            pm.outcome1Name &&
            outcome.name.toLowerCase().includes(pm.outcome1Name.toLowerCase())
          ) {
            outcome1Price = outcome.price;
          } else if (
            pm.outcome2Name &&
            outcome.name.toLowerCase().includes(pm.outcome2Name.toLowerCase())
          ) {
            outcome2Price = outcome.price;
          }
        }
      } else {
        // h2h and h2h_h1 — match by team name only
        if (pm.outcome1Name && teamsMatch(pm.outcome1Name, outcome.name)) {
          outcome1Price = outcome.price;
        } else if (
          pm.outcome2Name &&
          teamsMatch(pm.outcome2Name, outcome.name)
        ) {
          outcome2Price = outcome.price;
        }
      }
    }

    if (outcome1Price !== null && outcome2Price !== null) {
      bookmakerOdds.push({ bookmaker: bookKey, outcome1Price, outcome2Price });
    }
  }

  // helper
  function teamsMatch(pm: string, odds: string): boolean {
    const a = normalizeTeam(pm);
    const b = normalizeTeam(odds);
    return a === b || a.includes(b) || b.includes(a);
  }

  //taker ev
  // player_props use totals-style devigging (Over/Under binary)
  const devigType =
    pm.marketType === "h2h" || pm.marketType === "h2h_h1"
      ? "h2h"
      : pm.marketType === "spreads" || pm.marketType === "spreads_h1"
        ? "spreads"
        : "totals";

  const consensus = calculateWeightedConsensus(bookmakerOdds, devigType);
  if (!consensus) return;

  match.fairProbOutcome1 = consensus.consensus1;
  match.fairProbOutcome2 = consensus.consensus2;

  const takerMin = getTakerMinimum(makerMarketType(pm.marketType));
  const marketSlug =
    pm.marketSlug ?? pm.eventSlug ?? `${pm.eventTitle}-${pm.marketQuestion}`;
  const bucket1 = getCorrelationBucketKey(pm, 1);
  const bucket2 = getCorrelationBucketKey(pm, 2);

  const outcome1EV =
    pm.bestAsk1 !== undefined
      ? calculateEV(consensus.consensus1, pm.bestAsk1)
      : null;
  const outcome2EV =
    pm.bestAsk2 !== undefined
      ? calculateEV(consensus.consensus2, pm.bestAsk2)
      : null;

  // Determine which side has better taker EV
  let bestEV: number | null = null;
  let bestOutcome: 1 | 2 | null = null;
  if (outcome1EV !== null && outcome2EV !== null) {
    bestEV = outcome1EV >= outcome2EV ? outcome1EV : outcome2EV;
    bestOutcome = outcome1EV >= outcome2EV ? 1 : 2;
  } else if (outcome1EV !== null) {
    bestEV = outcome1EV;
    bestOutcome = 1;
  } else if (outcome2EV !== null) {
    bestEV = outcome2EV;
    bestOutcome = 2;
  }

  // player_props skip taker Kelly — we never take player prop orders,
  // but we still want EV recorded for logging/CLV tracking
  const skipTakerKelly = pm.marketType === "player_props";

  const outcome1Kelly =
    !skipTakerKelly &&
    pm.bestAsk1 !== undefined &&
    outcome1EV !== null &&
    outcome1EV >= takerMin
      ? calculateKellySize(
          consensus.consensus1,
          pm.bestAsk1,
          totalCapitalUsd,
          0,
          0,
        )
      : null;

  const outcome2Kelly =
    !skipTakerKelly &&
    pm.bestAsk2 !== undefined &&
    outcome2EV !== null &&
    outcome2EV >= takerMin
      ? calculateKellySize(
          consensus.consensus2,
          pm.bestAsk2,
          totalCapitalUsd,
          0,
          0,
        )
      : null;

  match.ev = {
    outcome1EV,
    outcome2EV,
    bestEV,
    bestOutcome,
    bookmakers: bookmakerOdds.map((b) => b.bookmaker),
    outcome1Kelly,
    outcome2Kelly,
  };

  // call maker ev
  calculateMakerEV(
    match,
    consensus.consensus1,
    consensus.consensus2,
    totalCapitalUsd,
  );
}

// ame bid price computation for outcome 1 and outcome 2 — the logic is identical, just mirrored

function calculateMakerEV(
  match: MatchedMarket,
  fairProb1: number,
  fairProb2: number,
  totalCapitalUsd: number,
): void {
  const pm = match.polymarket;
  const marketType = makerMarketType(pm.marketType);
  const marginRange = getMarginRange(marketType);
  const marketSlug =
    pm.marketSlug ?? pm.eventSlug ?? `${pm.eventTitle}-${pm.marketQuestion}`;
  const bucket1 = getCorrelationBucketKey(pm, 1);
  const bucket2 = getCorrelationBucketKey(pm, 2);

  match.makerEV = {
    outcome1BidPrice: null,
    outcome1BidMargin: null,
    outcome1BidEV: null,
    outcome1BidKelly: null,
    outcome2BidPrice: null,
    outcome2BidMargin: null,
    outcome2BidEV: null,
    outcome2BidKelly: null,
    bestMakerEV: null,
    bestMakerSide: null,
  };

  // ---- Outcome 1 bid ----
  let o1BidPrice = roundToWholePercent(
    fairProb1 - fairProb1 * marginRange.min,
    "down",
  );

  if (MAKER_STRATEGY === "incremental" && pm.bestBid1 !== undefined) {
    const improved = Math.min(0.99, pm.bestBid1 + 0.01);
    if (improved <= o1BidPrice) o1BidPrice = improved;
  }
  if (pm.bestBid1 !== undefined && o1BidPrice < pm.bestBid1)
    o1BidPrice = pm.bestBid1;
  if (pm.bestAsk1 !== undefined && o1BidPrice >= pm.bestAsk1) {
    o1BidPrice = Math.max(0.01, pm.bestAsk1 - 0.01);
  }

  const o1Margin = (fairProb1 - o1BidPrice) / fairProb1;
  if (o1Margin > marginRange.max) {
    o1BidPrice = roundToWholePercent(
      fairProb1 - fairProb1 * marginRange.max,
      "down",
    );
  }

  const o1BidEV = (fairProb1 - o1BidPrice) / fairProb1;
  const o1Competitive = pm.bestBid1 === undefined || o1BidPrice >= pm.bestBid1;
  const o1InsideSpread = pm.bestAsk1 === undefined || o1BidPrice < pm.bestAsk1;

  if (o1InsideSpread && o1Competitive) {
    match.makerEV.outcome1BidPrice = o1BidPrice;
    match.makerEV.outcome1BidMargin = o1BidEV;
    match.makerEV.outcome1BidEV = o1BidEV;
  }
  if (o1InsideSpread && o1Competitive && o1BidEV >= marginRange.min) {
    match.makerEV.outcome1BidKelly = calculateKellySize(
      fairProb1,
      o1BidPrice,
      totalCapitalUsd,
      0,
      0,
    );
  }

  // ---- Outcome 2 bid ----
  let o2BidPrice = roundToWholePercent(
    fairProb2 - fairProb2 * marginRange.min,
    "down",
  );

  if (MAKER_STRATEGY === "incremental" && pm.bestBid2 !== undefined) {
    const improved = Math.min(0.99, pm.bestBid2 + 0.01);
    if (improved <= o2BidPrice) o2BidPrice = improved;
  }
  if (pm.bestBid2 !== undefined && o2BidPrice < pm.bestBid2)
    o2BidPrice = pm.bestBid2;
  if (pm.bestAsk2 !== undefined && o2BidPrice >= pm.bestAsk2) {
    o2BidPrice = Math.max(0.01, pm.bestAsk2 - 0.01);
  }

  const o2Margin = (fairProb2 - o2BidPrice) / fairProb2;
  if (o2Margin > marginRange.max) {
    o2BidPrice = roundToWholePercent(
      fairProb2 - fairProb2 * marginRange.max,
      "down",
    );
  }

  const o2BidEV = (fairProb2 - o2BidPrice) / fairProb2;
  const o2Competitive = pm.bestBid2 === undefined || o2BidPrice >= pm.bestBid2;
  const o2InsideSpread = pm.bestAsk2 === undefined || o2BidPrice < pm.bestAsk2;

  if (o2InsideSpread && o2Competitive) {
    match.makerEV.outcome2BidPrice = o2BidPrice;
    match.makerEV.outcome2BidMargin = o2BidEV;
    match.makerEV.outcome2BidEV = o2BidEV;
  }
  if (o2InsideSpread && o2Competitive && o2BidEV >= marginRange.min) {
    match.makerEV.outcome2BidKelly = calculateKellySize(
      fairProb2,
      o2BidPrice,
      totalCapitalUsd,
      0,
      0,
    );
  }

  // Best maker side
  const candidates: Array<{ ev: number; side: 1 | 2 }> = [];
  if (match.makerEV.outcome1BidEV !== null)
    candidates.push({ ev: match.makerEV.outcome1BidEV, side: 1 });
  if (match.makerEV.outcome2BidEV !== null)
    candidates.push({ ev: match.makerEV.outcome2BidEV, side: 2 });
  if (candidates.length > 0) {
    const best = candidates.reduce((a, b) => (a.ev >= b.ev ? a : b));
    match.makerEV.bestMakerEV = best.ev;
    match.makerEV.bestMakerSide = best.side;
  }
}

// totalCapitalUsd must be USDC balance + open position value (not just free cash).
// Use computeCapitalSummary() from positions.ts to get this value correctly.
export function analyzeOpportunities(
  matched: MatchedMarket[],
  totalCapitalUsd: number,
): Opportunities {
  for (const match of matched) {
    if (Object.keys(match.sportsbooks).length > 0) {
      calculateMarketEV(match, totalCapitalUsd);
    }
  }

  const takers: TakerOpportunity[] = [];

  for (const match of matched) {
    if (!match.ev) continue;
    const pm = match.polymarket;
    if (pm.marketType === "player_props") continue;
    if (!pm.tokenId1 || !pm.tokenId2 || !pm.conditionId) continue;

    const marketSlug =
      pm.marketSlug ?? pm.eventSlug ?? `${pm.eventTitle}-${pm.marketQuestion}`;

    if (match.ev.outcome1Kelly && pm.bestAsk1 !== undefined) {
      takers.push({
        marketSlug,
        eventSlug: pm.eventSlug ?? pm.eventTitle ?? "unknown",
        eventTitle: pm.eventTitle,
        marketQuestion: pm.marketQuestion,
        sport: pm.sport,
        marketType: pm.marketType as MarketType,
        outcome: 1,
        outcomeName: pm.outcome1Name ?? "Outcome 1",
        tokenId: pm.tokenId1,
        conditionId: pm.conditionId,
        negRisk: pm.negRisk ?? false,
        tickSize: pm.tickSize ?? 0.001,
        minOrderSize: pm.minOrderSize ?? 5,
        fairProb: match.ev.outcome1Kelly.edge + pm.bestAsk1,
        polymarketAsk: pm.bestAsk1,
        ev: match.ev.outcome1EV!,
        bookmakers: match.ev.bookmakers,
        kellySize: match.ev.outcome1Kelly,
        eventStartTime: pm.startTime,
      });
    }

    if (match.ev.outcome2Kelly && pm.bestAsk2 !== undefined) {
      takers.push({
        marketSlug,
        eventSlug: pm.eventSlug ?? pm.eventTitle ?? "unknown",
        eventTitle: pm.eventTitle,
        marketQuestion: pm.marketQuestion,
        sport: pm.sport,
        marketType: pm.marketType as MarketType,
        outcome: 2,
        outcomeName: pm.outcome2Name ?? "Outcome 2",
        tokenId: pm.tokenId2,
        conditionId: pm.conditionId,
        negRisk: pm.negRisk ?? false,
        tickSize: pm.tickSize ?? 0.001,
        minOrderSize: pm.minOrderSize ?? 5,
        fairProb: match.ev.outcome2Kelly.edge + pm.bestAsk2,
        polymarketAsk: pm.bestAsk2,
        ev: match.ev.outcome2EV!,
        bookmakers: match.ev.bookmakers,
        kellySize: match.ev.outcome2Kelly,
        eventStartTime: pm.startTime,
      });
    }
  }

  const makers: MakerOpportunity[] = [];

  for (const match of matched) {
    if (!match.makerEV || !match.ev) continue;
    const pm = match.polymarket;
    if (!pm.tokenId1 || !pm.tokenId2 || !pm.conditionId) continue;

    const marketSlug =
      pm.marketSlug ?? pm.eventSlug ?? `${pm.eventTitle}-${pm.marketQuestion}`;
    const isFirstHalf = pm.marketType.endsWith("_h1");

    // player_props: only maker bids on outcome 2 (Under = No)
    const skipOutcome1 = pm.marketType === "player_props";

    if (
      !skipOutcome1 &&
      match.makerEV.outcome1BidKelly &&
      match.makerEV.outcome1BidPrice !== null
    ) {
      makers.push({
        marketSlug,
        eventSlug: pm.eventSlug ?? pm.eventTitle ?? "unknown",
        eventTitle: pm.eventTitle,
        marketQuestion: pm.marketQuestion,
        sport: pm.sport,
        marketType: pm.marketType as MarketType,
        bucketKey: getCorrelationBucketKey(pm, 1),
        isFirstHalf,
        outcome: 1,
        outcomeName: pm.outcome1Name ?? "Outcome 1",
        tokenId: pm.tokenId1,
        conditionId: pm.conditionId,
        negRisk: pm.negRisk ?? false,
        tickSize: pm.tickSize ?? 0.001,
        minOrderSize: pm.minOrderSize ?? 5,
        fairProb:
          match.makerEV.outcome1BidKelly.edge + match.makerEV.outcome1BidPrice,
        targetPrice: match.makerEV.outcome1BidPrice,
        currentBid: pm.bestBid1,
        margin: match.makerEV.outcome1BidMargin!,
        ev: match.makerEV.outcome1BidEV!,
        bookmakers: match.ev.bookmakers,
        kellySize: match.makerEV.outcome1BidKelly,
        eventStartTime: pm.startTime,
      });
    }

    if (
      match.makerEV.outcome2BidKelly &&
      match.makerEV.outcome2BidPrice !== null
    ) {
      makers.push({
        marketSlug,
        eventSlug: pm.eventSlug ?? pm.eventTitle ?? "unknown",
        eventTitle: pm.eventTitle,
        marketQuestion: pm.marketQuestion,
        sport: pm.sport,
        marketType: pm.marketType as MarketType,
        bucketKey: getCorrelationBucketKey(pm, 2),
        isFirstHalf,
        outcome: 2,
        outcomeName: pm.outcome2Name ?? "Outcome 2",
        tokenId: pm.tokenId2,
        conditionId: pm.conditionId,
        negRisk: pm.negRisk ?? false,
        tickSize: pm.tickSize ?? 0.001,
        minOrderSize: pm.minOrderSize ?? 5,
        fairProb:
          match.makerEV.outcome2BidKelly.edge + match.makerEV.outcome2BidPrice,
        targetPrice: match.makerEV.outcome2BidPrice,
        currentBid: pm.bestBid2,
        margin: match.makerEV.outcome2BidMargin!,
        ev: match.makerEV.outcome2BidEV!,
        bookmakers: match.ev.bookmakers,
        kellySize: match.makerEV.outcome2BidKelly,
        eventStartTime: pm.startTime,
      });
    }
  }

  return { takers, makers, matched };
}
