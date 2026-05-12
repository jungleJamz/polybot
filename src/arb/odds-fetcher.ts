import axios from "axios";
import type { OddsAPIEvent, PolymarketMarket } from "../types.js";
import { env, BOOKMAKERS, SPORT_MAP } from "../config.js";
import { normalizeTeam, isFirstHalf } from "../utils.js";

export class OddsApiQuotaError extends Error {
  constructor() {
    super("Odds API usage quota exhausted");
    this.name = "OddsApiQuotaError";
  }
}

const ODDS_API_BASE = "https://api.the-odds-api.com/v4";

// 8 concurrent + 50ms spacing → ~20 req/sec
const CONCURRENCY = 8;
const MIN_INTERVAL_MS = 50;

interface EventMarketNeeds {
  hasH2H: boolean;
  hasSpreads: boolean;
  hasTotals: boolean;
  hasFirstHalfH2H: boolean;
  hasFirstHalfSpreads: boolean;
  hasFirstHalfTotals: boolean;
  playerPropKeys: Set<string>;
}

interface SportMarketNeeds {
  hasSpreadsOrTotals: boolean;
  hasFirstHalf: boolean;
}

function statTypeToOddsAPIKey(statType: string, sport: string): string | null {
  if (["nba", "ncaab", "wnba"].includes(sport)) {
    const map: Record<string, string> = {
      points: "player_points",
      rebounds: "player_rebounds",
      assists: "player_assists",
      threes: "player_threes",
      blocks: "player_blocks",
      steals: "player_steals",
    };
    return map[statType] ?? null;
  }
  if (sport === "mlb") {
    const map: Record<string, string> = {
      strikeouts: "pitcher_strikeouts",
      hits: "batter_hits",
      "home runs": "batter_home_runs",
      "total bases": "batter_total_bases",
      rbis: "batter_rbis",
    };
    return map[statType] ?? null;
  }
  if (sport === "nhl") {
    const map: Record<string, string> = {
      points: "player_points",
      assists: "player_assists",
      goals: "player_goals",
      "shots on goal": "player_shots_on_goal",
      saves: "player_total_saves",
    };
    return map[statType] ?? null;
  }
  if (["nfl", "cfb"].includes(sport)) {
    const map: Record<string, string> = {
      "pass yards": "player_pass_yds",
      "rush yards": "player_rush_yds",
      "reception yards": "player_reception_yds",
      receptions: "player_receptions",
      "pass attempts": "player_pass_attempts",
      "pass completions": "player_pass_completions",
      "pass touchdowns": "player_pass_tds",
      "rush attempts": "player_rush_attempts",
      tackles: "player_tackles_assists",
      sacks: "player_sacks",
    };
    return map[statType] ?? null;
  }
  return null;
}

function buildEventMarketParams(needs?: EventMarketNeeds): string[] {
  if (!needs) return [];
  const markets: string[] = [];

  if (needs.hasFirstHalfH2H) markets.push("h2h_h1");
  if (needs.hasFirstHalfSpreads)
    markets.push("spreads_h1", "alternate_spreads_h1");
  if (needs.hasFirstHalfTotals)
    markets.push("totals_h1", "alternate_totals_h1");
  if (needs.hasSpreads) markets.push("alternate_spreads");
  if (needs.hasTotals) markets.push("alternate_totals");

  for (const key of needs.playerPropKeys) {
    markets.push(key, `${key}_alternate`);
  }

  return markets;
}

// Runs async tasks with bounded concurrency AND minimum spacing between starts.
//
// Concurrency alone allows bursting (8 requests in 1ms).
// Spacing alone (serial) wastes network parallelism.
// Together: up to 8 in-flight, but request starts spread >= 50ms apart.
//
// The chained `lock` promise is a mutex: only one worker at a time may
// claim the next task index + enforce the delay. Without it, two workers
// could claim the same index simultaneously.
async function runRateLimited<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
  minIntervalMs: number = 50,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;
  let lastStartTime = 0;
  let lock: Promise<void> = Promise.resolve();

  async function worker(): Promise<void> {
    while (true) {
      const taskIndex = await new Promise<number>((resolve) => {
        lock = lock.then(async () => {
          if (nextIndex >= tasks.length) {
            resolve(-1);
            return;
          }
          const elapsed = Date.now() - lastStartTime;
          if (elapsed < minIntervalMs) {
            await new Promise<void>((r) =>
              setTimeout(r, minIntervalMs - elapsed),
            );
          }
          lastStartTime = Date.now();
          resolve(nextIndex++);
        });
      });

      if (taskIndex === -1) break;
      results[taskIndex] = await tasks[taskIndex]!();
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, worker),
  );
  return results;
}

async function fetchBaseOddsForSport(
  sportKey: string,
  polymarketEvents: Set<string>,
): Promise<{ events: OddsAPIEvent[]; matchedEventKeys: Map<string, string> }> {
  try {
    const response = await axios.get<OddsAPIEvent[]>(
      `${ODDS_API_BASE}/sports/${sportKey}/odds`,
      {
        params: {
          apiKey: env.oddsApiKey,
          regions: "us",
          markets: "h2h,spreads,totals",
          oddsFormat: "american",
          bookmakers: BOOKMAKERS.join(","),
        },
      },
    );

    const matchedEventKeys = new Map<string, string>();

    const events = response.data.filter((event) => {
      const homeNorm = normalizeTeam(event.home_team);
      const awayNorm = normalizeTeam(event.away_team);

      for (const pmKey of polymarketEvents) {
        const [pmHome, pmAway] = pmKey.split("|");
        if (!pmHome || !pmAway) continue;

        const direct =
          (homeNorm.includes(pmHome) || pmHome.includes(homeNorm)) &&
          (awayNorm.includes(pmAway) || pmAway.includes(awayNorm));
        const flipped =
          (homeNorm.includes(pmAway) || pmAway.includes(homeNorm)) &&
          (awayNorm.includes(pmHome) || pmHome.includes(awayNorm));

        if (direct || flipped) {
          matchedEventKeys.set(event.id, pmKey);
          return true;
        }
      }
      return false;
    });

    return { events, matchedEventKeys };
  } catch (err: any) {
    if (err.response?.status === 404)
      return { events: [], matchedEventKeys: new Map() };
    if (err.response?.data?.error_code === "OUT_OF_USAGE_CREDITS")
      throw new OddsApiQuotaError();
    console.error(
      `[odds] fetch failed for ${sportKey}:`,
      err.response?.data ?? err.message,
    );
    return { events: [], matchedEventKeys: new Map() };
    console.error(
      `[odds] fetch failed for ${sportKey}:`,
      err.response?.data ?? err.message,
    );
    return { events: [], matchedEventKeys: new Map() };
  }
}

async function fetchAndMergeAlternates(
  sportKey: string,
  event: OddsAPIEvent,
  markets: string[],
): Promise<void> {
  try {
    const response = await axios.get<OddsAPIEvent>(
      `${ODDS_API_BASE}/sports/${sportKey}/events/${event.id}/odds`,
      {
        params: {
          apiKey: env.oddsApiKey,
          regions: "us",
          markets: markets.join(","),
          oddsFormat: "american",
          bookmakers: BOOKMAKERS.join(","),
        },
      },
    );

    for (const altBook of response.data.bookmakers ?? []) {
      const existing = event.bookmakers.find((b) => b.key === altBook.key);
      if (existing) {
        existing.markets.push(...altBook.markets);
      } else {
        event.bookmakers.push(altBook);
      }
    }
  } catch (err: any) {
    if (err.response?.status !== 404) {
      console.warn(
        `[odds] alternates failed for ${event.home_team} vs ${event.away_team}`,
      );
    }
  }
}

export async function fetchOddsForMarkets(
  markets: PolymarketMarket[],
): Promise<Record<string, OddsAPIEvent[]>> {
  // Group by sport
  const marketsBySport: Record<string, PolymarketMarket[]> = {};
  for (const m of markets) {
    (marketsBySport[m.sport] ??= []).push(m);
  }

  // Build needs profiles
  const polyEventsBySport: Record<string, Set<string>> = {};
  const eventNeedsBySport: Record<string, Map<string, EventMarketNeeds>> = {};
  const sportFallbacks: Record<string, SportMarketNeeds> = {};

  for (const [sport, sportMarkets] of Object.entries(marketsBySport)) {
    const eventKeys = new Set<string>();
    const eventNeeds = new Map<string, EventMarketNeeds>();
    let hasSpreadsOrTotals = false;
    let hasFirstHalf = false;

    for (const market of sportMarkets) {
      if (!market.homeTeam || !market.awayTeam) continue;

      const eventKey = `${normalizeTeam(market.homeTeam)}|${normalizeTeam(market.awayTeam)}`;
      eventKeys.add(eventKey);

      const needs: EventMarketNeeds = eventNeeds.get(eventKey) ?? {
        hasH2H: false,
        hasSpreads: false,
        hasTotals: false,
        hasFirstHalfH2H: false,
        hasFirstHalfSpreads: false,
        hasFirstHalfTotals: false,
        playerPropKeys: new Set(),
      };

      const fh = isFirstHalf(market.marketQuestion);

      if (market.marketType === "player_props" && market.playerStatType) {
        const apiKey = statTypeToOddsAPIKey(market.playerStatType, sport);
        if (apiKey) needs.playerPropKeys.add(apiKey);
      } else if (market.marketType === "h2h") {
        if (fh) {
          needs.hasFirstHalfH2H = true;
          hasFirstHalf = true;
        } else needs.hasH2H = true;
      } else if (
        market.marketType === "spreads" ||
        market.marketType === "spreads_h1"
      ) {
        if (fh) {
          needs.hasFirstHalfSpreads = true;
          hasFirstHalf = true;
        } else {
          needs.hasSpreads = true;
          hasSpreadsOrTotals = true;
        }
      } else if (
        market.marketType === "totals" ||
        market.marketType === "totals_h1"
      ) {
        if (fh) {
          needs.hasFirstHalfTotals = true;
          hasFirstHalf = true;
        } else {
          needs.hasTotals = true;
          hasSpreadsOrTotals = true;
        }
      }

      eventNeeds.set(eventKey, needs);
    }

    polyEventsBySport[sport] = eventKeys;
    eventNeedsBySport[sport] = eventNeeds;
    sportFallbacks[sport] = { hasSpreadsOrTotals, hasFirstHalf };
  }

  // Phase 1: base odds for all sports
  const sportEntries = Object.keys(marketsBySport)
    .filter((s): s is keyof typeof SPORT_MAP => s in SPORT_MAP)
    .map((s) => ({ pmSport: s, oddsApiSport: SPORT_MAP[s] }));

  const baseResults = await runRateLimited(
    sportEntries.map(
      ({ pmSport, oddsApiSport }) =>
        () =>
          fetchBaseOddsForSport(
            oddsApiSport,
            polyEventsBySport[pmSport] ?? new Set(),
          ),
    ),
    CONCURRENCY,
    MIN_INTERVAL_MS,
  );

  // Assemble results + collect Phase 2 tasks
  const oddsData: Record<string, OddsAPIEvent[]> = {};
  type AltTask = { sportKey: string; event: OddsAPIEvent; markets: string[] };
  const altTasks: AltTask[] = [];

  for (let i = 0; i < sportEntries.length; i++) {
    const { pmSport, oddsApiSport } = sportEntries[i]!;
    const { events, matchedEventKeys } = baseResults[i]!;
    oddsData[pmSport] = events;

    for (const event of events) {
      const pmKey =
        matchedEventKeys.get(event.id) ??
        `${normalizeTeam(event.home_team)}|${normalizeTeam(event.away_team)}`;

      let eventMarkets = buildEventMarketParams(
        eventNeedsBySport[pmSport]?.get(pmKey),
      );

      if (eventMarkets.length === 0) {
        const fb = sportFallbacks[pmSport];
        const fallback: string[] = [];
        if (fb?.hasSpreadsOrTotals)
          fallback.push("alternate_spreads", "alternate_totals");
        if (fb?.hasFirstHalf)
          fallback.push(
            "h2h_h1",
            "spreads_h1",
            "totals_h1",
            "alternate_spreads_h1",
            "alternate_totals_h1",
          );
        eventMarkets = [...new Set(fallback)];
      }

      if (eventMarkets.length > 0) {
        altTasks.push({ sportKey: oddsApiSport, event, markets: eventMarkets });
      }
    }
  }

  // Phase 2: alternate lines for all matched events
  if (altTasks.length > 0) {
    await runRateLimited(
      altTasks.map(
        ({ sportKey, event, markets }) =>
          () =>
            fetchAndMergeAlternates(sportKey, event, markets),
      ),
      CONCURRENCY,
      MIN_INTERVAL_MS,
    );
  }

  return oddsData;
}
