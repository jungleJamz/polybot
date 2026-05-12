import axios from "axios";
import type { OpenOrder, OpenOrderParams } from "@polymarket/clob-client";
import { getClobClient } from "./clob.js";
import { env } from "../config.js";
import type { PolymarketMarket, ExposureSnapshot } from "../types.js";
import { getCorrelationBucketKey } from "../arb/risk-buckets.js";

export interface RawPosition {
  asset: string; // token ID
  conditionId: string;
  size: number; // shares held
  avgPrice: number; // average entry price
  currentValue: number; // current market value in USD
  curPrice: number; // current market price per share
  slug?: string;
  [key: string]: unknown;
}

export interface EnrichedPosition {
  conditionId: string;
  tokenId: string;
  sport?: string;
  marketSlug?: string;
  eventSlug?: string;
  outcomeName?: string;
  bucketKey?: string;
  shares: number;
  avgEntryPrice: number;
  currentMarketPrice: number;
  currentValueUSD: number;
  unrealizedPnL: number;
}

export interface CapitalSummary {
  usdcBalance: number;
  totalPositionValueUSD: number;
  totalCapitalUSD: number; // usdcBalance + totalPositionValueUSD
  openOrderCount: number;
}

export async function fetchOpenOrders(
  params?: OpenOrderParams,
): Promise<OpenOrder[]> {
  const client = await getClobClient();
  return client.getOpenOrders(params, true);
}

export async function fetchCurrentPositions(
  userAddress?: string,
): Promise<RawPosition[]> {
  const user = userAddress?.trim() || env.proxyWallet;
  const { data } = await axios.get<RawPosition[]>(
    `${env.dataApiUrl}/positions`,
    {
      params: { user },
    },
  );
  return data;
}

export function buildEnrichedPositions(
  markets: PolymarketMarket[],
  rawPositions: RawPosition[],
): EnrichedPosition[] {
  // Index markets by conditionId for O(1) lookup
  const byCondition = new Map<string, PolymarketMarket>();
  for (const m of markets) {
    if (m.conditionId && !byCondition.has(m.conditionId)) {
      byCondition.set(m.conditionId, m);
    }
  }

  const enriched: EnrichedPosition[] = [];

  for (const raw of rawPositions) {
    if (!raw.conditionId || !raw.asset) continue;
    const shares = raw.size ?? 0;
    if (shares === 0) continue;

    const market = byCondition.get(raw.conditionId);
    let outcomeName: string | undefined;
    let sport: string | undefined;
    let marketSlug: string | undefined;
    let eventSlug: string | undefined;
    let bucketKey: string | undefined;
    let currentMarketPrice = raw.curPrice ?? 0;

    if (market) {
      sport = market.sport;
      marketSlug = market.marketSlug;
      eventSlug = market.eventSlug;

      if (raw.asset === market.tokenId1) {
        outcomeName = market.outcome1Name;
        bucketKey = getCorrelationBucketKey(market, 1);
        currentMarketPrice =
          market.lastPrice ?? market.bestAsk1 ?? currentMarketPrice;
      } else if (raw.asset === market.tokenId2) {
        outcomeName = market.outcome2Name;
        bucketKey = getCorrelationBucketKey(market, 2);
        currentMarketPrice = market.bestAsk2 ?? currentMarketPrice;
      }
    }

    enriched.push({
      conditionId: raw.conditionId,
      tokenId: raw.asset,
      sport,
      marketSlug,
      eventSlug,
      outcomeName,
      bucketKey,
      shares,
      avgEntryPrice: raw.avgPrice ?? 0,
      currentMarketPrice,
      currentValueUSD: raw.currentValue ?? 0,
      unrealizedPnL: (currentMarketPrice - (raw.avgPrice ?? 0)) * shares,
    });
  }

  return enriched;
}

export function buildExposureSnapshotsFromPositions(
  markets: PolymarketMarket[],
  rawPositions: RawPosition[],
): ExposureSnapshot[] {
  const enriched = buildEnrichedPositions(markets, rawPositions);
  const snapshots: ExposureSnapshot[] = [];

  for (const p of enriched) {
    if (!Number.isFinite(p.currentValueUSD) || p.currentValueUSD <= 0) continue;
    const marketKey =
      p.marketSlug ??
      (p.eventSlug ? `${p.eventSlug}:${p.conditionId}` : p.conditionId);
    snapshots.push({
      marketKey,
      bucketKey: p.bucketKey ?? marketKey,
      exposureUSD: p.currentValueUSD,
    });
  }

  return snapshots;
}

// Open orders don't lock capital on Polymarket, but their notional size
// still counts toward per-market and per-bucket exposure limits.
// NOTE: buildExposureSnapshotsFromMakerOrders is deferred to Group 4
// when maker-registry.ts is written.

export function computeCapitalSummary(
  usdcBalance: number,
  rawPositions: RawPosition[],
  openOrders: OpenOrder[],
): CapitalSummary {
  const totalPositionValueUSD = rawPositions.reduce(
    (sum, p) => sum + (Number(p.currentValue) || 0),
    0,
  );
  return {
    usdcBalance,
    totalPositionValueUSD,
    totalCapitalUSD: usdcBalance + totalPositionValueUSD,
    openOrderCount: openOrders.length,
  };
}
