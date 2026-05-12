import type {
  PolymarketMarket,
  OddsAPIEvent,
  OddsAPIMarket,
  MatchedMarket,
  MarketType,
} from "../types.js";
import { BOOKMAKERS } from "../config.js";
import { normalizeTeam } from "../utils";

function teamsMatch(a: string, b: string): boolean {
  const an = normalizeTeam(a);
  const bn = normalizeTeam(b);
  return an === bn || an.includes(bn) || bn.includes(an);
}

// Extracts the numeric line from a Polymarket question.
// Totals: "Will total points be o/u 47.5?" → 47.5
// Spreads: "Chiefs spread (-3.5)" → -3.5
function extractLine(question: string, marketType: MarketType): number | null {
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

function findMatchingEvent(
  market: PolymarketMarket,
  oddsEvents: OddsAPIEvent[],
): OddsAPIEvent | null {
  if (!market.homeTeam || !market.awayTeam) return null;

  return (
    oddsEvents.find((event) => {
      const normalMatch =
        teamsMatch(market.homeTeam!, event.home_team) &&
        teamsMatch(market.awayTeam!, event.away_team);
      const reversedMatch =
        teamsMatch(market.homeTeam!, event.away_team) &&
        teamsMatch(market.awayTeam!, event.home_team);
      return normalMatch || reversedMatch;
    }) ?? null
  );
}

// Returns the first matching OddsAPIMarket from a bookmaker for the given
// Polymarket market. For spreads/totals, the line must match exactly.
function findOddsMarket(
  bookmakerMarkets: OddsAPIMarket[],
  marketType: MarketType,
  requiredLine: number | null,
): OddsAPIMarket | null {
  // Build list of Odds API keys to try, in priority order.
  // For spreads/totals, try the featured line first, then alternate lines.
  const keysToTry: string[] =
    marketType === "spreads" || marketType === "spreads_h1"
      ? [marketType, `alternate_${marketType}`]
      : marketType === "totals" || marketType === "totals_h1"
        ? [marketType, `alternate_${marketType}`]
        : [marketType]; // h2h and h2h_h1 — no alternates needed

  for (const key of keysToTry) {
    const market = bookmakerMarkets.find((m) => m.key === key);
    if (!market) continue;

    // h2h: just return it — no line to match
    if (requiredLine === null) return market;

    // spreads/totals: verify the exact line exists
    const hasLine = market.outcomes.some(
      (o) => o.point !== undefined && Math.abs(o.point - requiredLine) < 0.01,
    );
    if (hasLine) return market;
  }

  return null;
}

function matchMarket(
  market: PolymarketMarket,
  oddsEvents: OddsAPIEvent[],
): MatchedMarket {
  const result: MatchedMarket = { polymarket: market, sportsbooks: {} };

  if (!market.homeTeam || !market.awayTeam) {
    result.skipReason = "No team names";
    return result;
  }
  if (market.marketType === "player_props") {
    result.skipReason = "Player props not supported";
    return result;
  }

  const event = findMatchingEvent(market, oddsEvents);
  if (!event) {
    result.skipReason = "Event not found in sportsbooks";
    return result;
  }

  const requiredLine = extractLine(market.marketQuestion, market.marketType);

  // For spreads/totals, a missing line means we can't verify the match
  if (
    (market.marketType === "spreads" ||
      market.marketType === "spreads_h1" ||
      market.marketType === "totals" ||
      market.marketType === "totals_h1") &&
    requiredLine === null
  ) {
    result.skipReason = "Could not extract line from market question";
    return result;
  }

  for (const bookmaker of event.bookmakers) {
    if (!(BOOKMAKERS as string[]).includes(bookmaker.key)) continue;

    const oddsMarket = findOddsMarket(
      bookmaker.markets,
      market.marketType,
      requiredLine,
    );
    if (!oddsMarket) continue;

    result.sportsbooks[bookmaker.key] = { market: oddsMarket, event };
  }

  if (Object.keys(result.sportsbooks).length === 0) {
    if (requiredLine !== null) {
      // Collect available lines for debugging
      const available = new Set<number>();
      for (const bk of event.bookmakers) {
        for (const m of bk.markets) {
          for (const o of m.outcomes) {
            if (o.point !== undefined) available.add(o.point);
          }
        }
      }
      const lines = Array.from(available)
        .sort((a, b) => a - b)
        .join(", ");
      result.skipReason = `Line ${requiredLine} not found. Available: ${lines || "none"}`;
    } else {
      result.skipReason = "No matching markets at any bookmaker";
    }
  }

  return result;
}

export function matchMarkets(
  markets: PolymarketMarket[],
  oddsData: Record<string, OddsAPIEvent[]>,
): MatchedMarket[] {
  const results: MatchedMarket[] = [];

  // Group by sport to avoid matching NFL markets against NBA events
  const bySport = new Map<string, PolymarketMarket[]>();
  for (const market of markets) {
    const group = bySport.get(market.sport) ?? [];
    group.push(market);
    bySport.set(market.sport, group);
  }

  for (const [sport, sportMarkets] of bySport) {
    const events = oddsData[sport] ?? [];
    for (const market of sportMarkets) {
      results.push(matchMarket(market, events));
    }
  }

  return results;
}
