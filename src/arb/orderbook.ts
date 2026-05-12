import type { OrderBookSummary } from "@polymarket/clob-client";
import { getClobClient } from "../clients/clob.js";
import type { PolymarketMarket } from "../types.js";

export interface BestPrices {
  bestBid: number | null;
  bestAsk: number | null;
}

// Fetches the live best bid and best ask for each token ID.
// Best bid = highest resting buy order. Best ask = lowest resting sell order.
export async function fetchBestPricesForTokens(
  tokenIds: string[],
): Promise<Map<string, BestPrices>> {
  const unique = [...new Set(tokenIds)].filter(Boolean);
  const result = new Map<string, BestPrices>();
  if (unique.length === 0) return result;

  const client = await getClobClient();

  for (const tokenId of unique) {
    try {
      const book: OrderBookSummary = await client.getOrderBook(tokenId);
      const bestBid =
        book.bids?.length > 0
          ? Math.max(...book.bids.map((b) => parseFloat(b.price ?? "0")))
          : null;
      const bestAsk =
        book.asks?.length > 0
          ? Math.min(...book.asks.map((a) => parseFloat(a.price ?? "0")))
          : null;
      result.set(tokenId, { bestBid, bestAsk });
    } catch {
      // Skip — market keeps its Gamma prices; analyzer will handle missing prices
    }
  }

  return result;
}

// Replaces Gamma's cached prices with live CLOB prices for outcome 1,
// then derives outcome 2 prices as complements.
export async function enrichMarketsWithClobQuotes(
  markets: PolymarketMarket[],
): Promise<PolymarketMarket[]> {
  const tokenIds = markets
    .map((m) => m.tokenId1)
    .filter((id): id is string => id != null);

  const priceMap = await fetchBestPricesForTokens(tokenIds);

  for (const market of markets) {
    if (!market.tokenId1) continue;
    const prices = priceMap.get(market.tokenId1);
    if (!prices) continue;

    const { bestBid, bestAsk } = prices;

    if (bestBid !== null) market.bestBid1 = bestBid;
    if (bestAsk !== null) market.bestAsk1 = bestAsk;

    // Derive outcome 2 complement prices — only valid when both sides exist
    if (bestBid !== null && bestAsk !== null) {
      market.bestBid2 = 1 - bestAsk;
      market.bestAsk2 = 1 - bestBid;
    }
  }

  return markets;
}
