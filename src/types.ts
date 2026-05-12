import type { MarketType, SportCode } from "./config.js";
export type { MarketType, SportCode }; // Which outcome we're referring to in a binary market.
// Outcome 1 = YES / home / over / favorite (depends on market).
// Outcome 2 = NO  / away / under / underdog.
export type OutcomeIndex = 1 | 2;

export interface GammaEvent {
  id: string;
  title: string | null;
  slug: string | null;
  startDate?: string | null;
  endDate?: string | null;
  closed?: boolean | null;
  active?: boolean | null;
  markets?: GammaMarket[];
  startTime?: string | null;
  eventDate?: string | null;
  tags?: Array<{ id: string; label: string; slug: string }> | null;
}

export interface GammaMarket {
  id: string;
  question: string | null;
  slug?: string | null;
  liquidityNum?: number | null;
  gameStartTime?: string | null;
  eventStartTime?: string | null;
  closed?: boolean | null;
  active?: boolean | null;
  outcomes?: string | null; // stringified JSON: '["Yes","No"]'
  outcomePrices?: string | null; // stringified JSON: '["0.55","0.45"]'
  lastTradePrice?: number | null;
  bestBid?: number | null;
  bestAsk?: number | null;
  clobTokenIds?: string | null; // stringified JSON: '["123","456"]'
  conditionId?: string | null;
  negRisk?: boolean | null;
  orderPriceMinTickSize?: number | null;
  orderMinSize?: number | null;
  liquidityClob?: number | null;
  liquidityAmm?: number | null;
  liquidity?: string | null; // sometimes returned as a string, not a number
}

export interface OddsAPIOutcome {
  name: string;
  price: number; // American odds e.g. -110, +220
  point?: number; // Spread/total line e.g. -3.5, 47.5
}

export interface OddsAPIMarket {
  key: string; // "h2h" | "spreads" | "totals"
  last_update: string; // ISO timestamp
  outcomes: OddsAPIOutcome[];
}

export interface OddsAPIBookmaker {
  key: string; // "pinnacle", "draftkings", etc.
  title: string;
  last_update: string;
  markets: OddsAPIMarket[];
}

export interface OddsAPIEvent {
  id: string;
  sport_key: string; // "americanfootball_nfl"
  sport_title: string;
  commence_time: string; // ISO timestamp
  home_team: string;
  away_team: string;
  bookmakers: OddsAPIBookmaker[];
}

export interface PolymarketMarket {
  // identity
  // marketId: string;
  conditionId?: string;
  marketSlug?: string;
  eventSlug?: string;
  eventTitle: string;
  marketQuestion: string;
  sport: string;
  marketType: MarketType | "player_props";
  playerStatType?: string; // e.g. "points", "rebounds" — player props only
  // game timing
  startTime: string; // ISO string

  // teams (optional — totals markets have no teams)
  homeTeam?: string;
  awayTeam?: string;

  // CLOB trading fields (required — enriched by CLOB API)
  tokenId1?: string; // YES token
  tokenId2?: string; // NO token
  negRisk?: boolean;
  tickSize?: number;
  minOrderSize?: number;

  // current market prices
  bestBid1?: number; // YES side best bid
  bestAsk1?: number; // YES side best ask
  bestBid2?: number; // NO side best bid
  bestAsk2?: number; // NO side best ask
  lastPrice?: number;

  // liquidity
  liquidity: number;

  // outcome labels
  outcome1Name?: string; // e.g. "Kansas City Chiefs"
  outcome2Name?: string; // e.g. "Buffalo Bills"

  playerName?: string;
  playerLine?: number;
}

export interface KellySize {
  edge: number; // fairProb - impliedProb
  kellyFraction: number; // raw Kelly fraction (edge / impliedOdds)
  rawKellySizeUSD: number; // bankroll * kellyFraction * KELLY_MULTIPLIER
  rawKellyShares: number; // rawKellySizeUSD / price
  constrainedSizeUSD: number; // after per-market and per-bucket caps
  constrainedShares: number;
  limitingFactor: string; // "kelly" | "market-cap" | "bucket-cap"
  bankrollPct: number; // constrainedSizeUSD / bankroll
}

// MatchedMarket represents one market through the analysis pipeline.
// Stage 1 (after matching):  polymarket + sportsbooks populated
// Stage 2 (after calculator): fairProbOutcome1/2, ev, makerEV populated
export interface MatchedMarket {
  polymarket: PolymarketMarket;
  sportsbooks: {
    [bookmaker: string]: {
      market: OddsAPIMarket;
      event: OddsAPIEvent;
    };
  };
  skipReason?: string;

  // Stage 2 fields — populated by calculator
  fairProbOutcome1?: number;
  fairProbOutcome2?: number;

  ev?: {
    outcome1EV: number | null;
    outcome2EV: number | null;
    bestEV: number | null;
    bestOutcome: OutcomeIndex | null;
    bookmakers: string[];
    outcome1Kelly: KellySize | null;
    outcome2Kelly: KellySize | null;
  };

  makerEV?: {
    outcome1BidPrice: number | null;
    outcome1BidMargin: number | null;
    outcome1BidEV: number | null;
    outcome1BidKelly: KellySize | null;
    outcome2BidPrice: number | null;
    outcome2BidMargin: number | null;
    outcome2BidEV: number | null;
    outcome2BidKelly: KellySize | null;
    bestMakerEV: number | null;
    bestMakerSide: OutcomeIndex | null;
  };
}

export interface TakerOpportunity {
  marketSlug: string;
  eventSlug: string;
  eventTitle: string;
  marketQuestion: string;
  sport: string;
  marketType: MarketType;
  outcome: OutcomeIndex;
  outcomeName: string;
  tokenId: string;
  conditionId: string;
  negRisk: boolean;
  tickSize: number;
  minOrderSize: number;
  fairProb: number;
  polymarketAsk: number;
  ev: number;
  bookmakers: string[];
  kellySize: KellySize;
  eventStartTime?: string;
}

export interface MakerOpportunity {
  marketSlug: string;
  eventSlug: string;
  eventTitle: string;
  marketQuestion: string;
  sport: string;
  marketType: MarketType;
  bucketKey: string; // e.g. "nfl:2024-01-14:chiefs-bills"
  isFirstHalf: boolean;
  outcome: OutcomeIndex;
  outcomeName: string;
  tokenId: string;
  conditionId: string;
  negRisk: boolean;
  tickSize: number;
  minOrderSize: number;
  fairProb: number;
  targetPrice: number; // the price we'll post at
  currentBid?: number; // best existing bid (we may need to outbid)
  margin: number;
  ev: number;
  bookmakers: string[];
  kellySize: KellySize;
  eventStartTime?: string;
}

export interface Opportunities {
  takers: TakerOpportunity[];
  makers: MakerOpportunity[];
  matched: MatchedMarket[]; // full analysis results (for logging/CLV tracking)
}
