import axios from "axios";
import type { GammaEvent, GammaMarket, PolymarketMarket } from "../types.js";
import { HOURS_AHEAD } from "../config.js";
import { isFirstHalf } from "../utils.js";
import { log } from "../logger.js";

const GAMMA_BASE = "https://gamma-api.polymarket.com";
const MAX_CONCURRENT = 5;
const REQUEST_DELAY_MS = 100;

// Gamma tag IDs for each sport we actively trade.
// Only includes sports present in SPORT_MAP — no point fetching what we can't price.
const SPORT_TAG_MAP: Record<string, string[]> = {
  nfl: ["450"],
  nba: ["745"],
  nhl: ["899"],
  mlb: ["100381"],
};

const axGamma = axios.create({
  baseURL: GAMMA_BASE,
  timeout: 10000,
  headers: { Connection: "keep-alive" },
});

// extractStartTime — tries five fields in priority order; returns null if none parse:
function calculateLiquidity(market: GammaMarket): number {
  if (typeof market.liquidityNum === "number" && market.liquidityNum > 0) {
    return market.liquidityNum;
  }
  const clobLiq = market.liquidityClob ?? 0;
  const ammLiq = market.liquidityAmm ?? 0;
  if (clobLiq + ammLiq > 0) return clobLiq + ammLiq;
  if (market.liquidity) {
    const parsed = parseFloat(market.liquidity);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

// parseTeamNames - splits on known seperates with @, left=away, right=home
function parseTeamNames(title: string): {
  homeTeam?: string;
  awayTeam?: string;
} {
  for (const sep of [" vs. ", " vs ", " @ ", " v "]) {
    if (!title.includes(sep)) continue;
    const parts = title.split(sep);
    if (parts.length === 2 && parts[0] && parts[1]) {
      return { awayTeam: parts[0].trim(), homeTeam: parts[1].trim() };
    }
  }
  return {};
}

function extractStartTime(
  event: GammaEvent,
  market?: GammaMarket,
): Date | null {
  const candidates = [
    event.startTime,
    market?.gameStartTime,
    market?.eventStartTime,
    event.eventDate,
    event.startDate,
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

// detectMarketType — player props must come before totals since both use "O/U":
const PLAYER_PROP_RE = new RegExp(
  String.raw`^(.+?):\s*(Points|Rebounds|Assists|Threes|Blocks|Steals|` +
    String.raw`Strikeouts|Hits|Home Runs|Total Bases|RBIs|Goals|Shots on Goal|Saves|` +
    String.raw`Pass Yards|Rush Yards|Reception Yards|Receptions|Pass Attempts|` +
    String.raw`Pass Completions|Pass Touchdowns|Rush Attempts|Tackles|Sacks)` +
    String.raw`\s+O\/U\s+(\d+\.?\d*)`,
  "i",
);

function detectMarketType(
  question: string,
): PolymarketMarket["marketType"] | "other" {
  const q = question.toLowerCase();

  if (PLAYER_PROP_RE.test(question)) return "player_props";

  if (q.includes("o/u") || q.includes("over/under") || q.includes("total")) {
    return isFirstHalf(question) ? "totals_h1" : "totals";
  }

  if (
    q.includes("spread:") ||
    q.includes("spread ") ||
    /\([+-]?\d+\.?\d*\)/.test(question) ||
    /[+-]\d+\.5\b/.test(question)
  ) {
    return isFirstHalf(question) ? "spreads_h1" : "spreads";
  }

  if (q.includes("will") && q.includes("win")) {
    return isFirstHalf(question) ? "h2h_h1" : "h2h";
  }

  if (
    q.includes("vs") ||
    q.includes("@") ||
    q.includes("draw") ||
    q.includes("tie")
  ) {
    return "h2h";
  }

  return "other";
}

// parsePlayerProp — extracts player name, stat type, and line
function parsePlayerProp(
  question: string,
): { playerName: string; statType: string; line: number } | null {
  const match = PLAYER_PROP_RE.exec(question);
  if (!match) return null;
  return {
    playerName: match[1]!.trim(),
    statType: match[2]!.toLowerCase(),
    line: parseFloat(match[3]!),
  };
}

async function fetchEventsForTag(tagId: string): Promise<GammaEvent[]> {
  try {
    const { data } = await axGamma.get<GammaEvent[]>("/events", {
      params: { tag_id: tagId, closed: false, active: true, limit: 100 },
    });
    return data ?? [];
  } catch (err: any) {
    if (err.response?.status !== 404) {
      console.warn(`[discovery] fetch failed for tag ${tagId}:`, err.message);
    }
    return [];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// fetch loop
export async function discoverPolymarkets(): Promise<PolymarketMarket[]> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + HOURS_AHEAD * 60 * 60 * 1000);

  // Flatten SPORT_TAG_MAP into individual {sport, tagId} requests
  const requests: Array<{ sport: string; tagId: string }> = [];
  for (const [sport, tagIds] of Object.entries(SPORT_TAG_MAP)) {
    for (const tagId of tagIds) {
      requests.push({ sport, tagId });
    }
  }

  // Fetch in batches of MAX_CONCURRENT with a delay between batches
  const allResults: Array<{ sport: string; events: GammaEvent[] }> = [];
  for (let i = 0; i < requests.length; i += MAX_CONCURRENT) {
    const chunk = requests.slice(i, i + MAX_CONCURRENT);
    const settled = await Promise.allSettled(
      chunk.map(async ({ sport, tagId }) => {
        const events = await fetchEventsForTag(tagId);
        return { sport, events };
      }),
    );
    for (const r of settled) {
      if (r.status === "fulfilled" && r.value.events.length > 0) {
        allResults.push(r.value);
      }
    }
    if (i + MAX_CONCURRENT < requests.length) await sleep(REQUEST_DELAY_MS);
  }

  // filter funnel
  const allMarkets: PolymarketMarket[] = [];
  let counts = {
    events: 0,
    noMarkets: 0,
    noStartTime: 0,
    outsideWindow: 0,
    closed: 0,
    noBidAsk: 0,
    phantom: 0,
    other: 0,
  };

  for (const { sport, events } of allResults) {
    for (const event of events) {
      counts.events++;
      if (!event.markets?.length) {
        counts.noMarkets++;
        continue;
      }

      const eventStartTime = extractStartTime(event);
      if (!eventStartTime) {
        counts.noStartTime++;
        continue;
      }
      if (eventStartTime < now || eventStartTime > windowEnd) {
        counts.outsideWindow++;
        continue;
      }

      for (const market of event.markets) {
        if (market.closed || market.active === false) {
          counts.closed++;
          continue;
        }

        const hasBid = market.bestBid != null && market.bestBid !== 0;
        const hasAsk = market.bestAsk != null && market.bestAsk !== 0;
        if (!hasBid && !hasAsk) {
          counts.noBidAsk++;
          continue;
        }

        if (hasBid && hasAsk) {
          const spread = market.bestAsk! - market.bestBid!;
          if (
            spread > 0.9 ||
            (market.bestBid! < 0.02 && market.bestAsk! > 0.98)
          ) {
            counts.phantom++;
            continue;
          }
        }

        const marketType = detectMarketType(market.question ?? "");
        if (marketType === "other") {
          counts.other++;
          continue;
        }

        const startTime = extractStartTime(event, market) ?? eventStartTime;
        const { homeTeam, awayTeam } = parseTeamNames(event.title ?? "");

        const pm: PolymarketMarket = {
          sport,
          eventTitle: event.title ?? "Unknown Event",
          marketQuestion: market.question ?? "",
          marketType,
          startTime: startTime.toISOString(),
          liquidity: calculateLiquidity(market),
        };

        if (homeTeam) pm.homeTeam = homeTeam;
        if (awayTeam) pm.awayTeam = awayTeam;
        if (event.slug) pm.eventSlug = event.slug;
        if (market.slug) pm.marketSlug = market.slug;
        if (market.conditionId) pm.conditionId = market.conditionId;
        if (market.negRisk != null) pm.negRisk = market.negRisk;
        if (market.orderPriceMinTickSize != null)
          pm.tickSize = market.orderPriceMinTickSize;
        if (market.orderMinSize != null) pm.minOrderSize = market.orderMinSize;

        // Parse clobTokenIds from stringified JSON → tokenId1/tokenId2
        if (market.clobTokenIds) {
          try {
            const ids = JSON.parse(market.clobTokenIds);
            if (Array.isArray(ids) && ids.length >= 2) {
              pm.tokenId1 = ids[0];
              pm.tokenId2 = ids[1];
            }
          } catch {
            console.warn(`[discovery] bad clobTokenIds for ${market.slug}`);
          }
        }

        // Outcome names
        try {
          const outcomes: string[] = market.outcomes
            ? JSON.parse(market.outcomes)
            : [];
          if (outcomes[0]) pm.outcome1Name = outcomes[0];
          if (outcomes[1]) pm.outcome2Name = outcomes[1];
        } catch {
          /* leave unset */
        }

        // Prices from Gamma (approximate — CLOB enrichment will update these)
        if (market.bestBid != null) {
          pm.bestBid1 = market.bestBid;
          pm.bestAsk2 = 1 - market.bestBid;
        }
        if (market.bestAsk != null) {
          pm.bestAsk1 = market.bestAsk;
          pm.bestBid2 = 1 - market.bestAsk;
        }
        if (market.lastTradePrice != null) pm.lastPrice = market.lastTradePrice;

        // Player prop extras
        if (marketType === "player_props") {
          const prop = parsePlayerProp(market.question ?? "");
          if (prop) {
            pm.playerName = prop.playerName;
            pm.playerStatType = prop.statType;
            pm.playerLine = prop.line;
          }
        }

        allMarkets.push(pm);
      }
    }
  }

  // console.log(`[discovery] funnel — events: ${counts.events}, no-markets: ${counts.noMarkets}, no-time: ${counts.noStartTime}, outside-window:
  // ${counts.outsideWindow}, closed: ${counts.closed}, no-bid-ask: ${counts.noBidAsk}, phantom: ${counts.phantom}, other: ${counts.other}, passed:
  // ${allMarkets.length}`);
  log.info(`[discovery] events:${counts.events} outside-window:${counts.outsideWindow} phantom:${counts.phantom} no-bid-ask:${counts.noBidAsk}
  passed:${allMarkets.length}`);

  // Deduplicate by marketSlug if available, otherwise eventTitle + question
  const seen = new Set<string>();
  return allMarkets.filter((m) => {
    const key = m.marketSlug
      ? `slug:${m.marketSlug}`
      : `${m.eventSlug ?? m.eventTitle}:${m.marketQuestion}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
