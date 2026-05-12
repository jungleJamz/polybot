import "dotenv/config";
import { validateEnv, env, TAKER_MIN_BOOKMAKERS } from "./config.js";
import { discoverPolymarkets } from "./arb/discovery.js";
import { matchMarkets } from "./arb/matcher.js";
import { analyzeOpportunities } from "./arb/analyzer.js";
import { enrichMarketsWithClobQuotes } from "./arb/orderbook.js";
import { fetchBestPricesForTokens } from "./arb/orderbook.js";
import { executeTakerOrder, placeMakerOrder } from "./arb/execution.js";
import { evaluateMakerOrders } from "./arb/maker-management.js";
import { fetchWalletState } from "./clients/wallet.js";
import {
  fetchCurrentPositions,
  fetchOpenOrders,
  computeCapitalSummary,
  buildEnrichedPositions,
  buildExposureSnapshotsFromPositions,
} from "./clients/positions.js";
import { getClobClient } from "./clients/clob.js";
import {
  registerMakerOrder,
  getTrackedMakerOrders,
  removeMakerOrder,
} from "./storage/maker-registry.js";
import { saveWager, updateWagerCLV } from "./storage/operations.js";
import { trackMakerFills } from "./storage/tracking.js";
import type { TakerOpportunity, MakerOpportunity } from "./types.js";
import type { EnrichedPosition } from "./clients/positions.js";
import { fetchOddsForMarkets, OddsApiQuotaError } from "./arb/odds-fetcher.js";
// ============================================================================
// STARTUP
// ============================================================================

validateEnv();

const DRY_RUN = env.dryRun;
const POLLING_INTERVAL_MS = env.pollingIntervalMs;

// ============================================================================
// HELPERS
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function buildPositionMap(
  positions: EnrichedPosition[],
): Map<string, EnrichedPosition> {
  return new Map(positions.map((p) => [p.tokenId, p]));
}

// ============================================================================
// TAKER EXECUTION
// ============================================================================

async function executeTakers(
  takers: TakerOpportunity[],
  positionMap: Map<string, EnrichedPosition>,
): Promise<void> {
  if (takers.length === 0) {
    console.log("   No taker opportunities.");
    return;
  }

  for (const taker of takers) {
    if (taker.bookmakers.length < TAKER_MIN_BOOKMAKERS) {
      console.log(
        `   skip ${taker.marketSlug} (${taker.outcomeName}): only ${taker.bookmakers.length} books`,
      );
      continue;
    }

    const currentShares = positionMap.get(taker.tokenId)?.shares ?? 0;
    const sharesToBuy = Math.max(
      0,
      taker.kellySize.constrainedShares - currentShares,
    );

    if (sharesToBuy < taker.minOrderSize) {
      console.log(
        `   skip ${taker.marketSlug} (${taker.outcomeName}): already own ${currentShares.toFixed(2)} shares`,
      );
      continue;
    }

    const adjusted: TakerOpportunity = {
      ...taker,
      kellySize: {
        ...taker.kellySize,
        constrainedShares: sharesToBuy,
        constrainedSizeUSD: sharesToBuy * taker.polymarketAsk,
      },
    };

    try {
      const result = await executeTakerOrder(adjusted, { dryRun: DRY_RUN });

      if (DRY_RUN) {
        console.log(`   [DRY] taker ${taker.marketSlug} (${taker.outcomeName}) EV=${(taker.ev * 100).toFixed(2)}%
  size=${sharesToBuy.toFixed(2)}@${(taker.polymarketAsk * 100).toFixed(1)}%`);
      } else if (result.filled && result.orderId) {
        console.log(`   filled ${taker.marketSlug} order=${result.orderId}`);
        saveWager({
          order_id: result.orderId,
          token_id: taker.tokenId,
          market_slug: taker.marketSlug,
          event_slug: taker.eventSlug,
          sport: taker.sport,
          market_type: taker.marketType,
          outcome: taker.outcome,
          side: "BUY",
          order_type: "TAKER",
          price: taker.polymarketAsk,
          size_filled: sharesToBuy,
          ev_at_placement: taker.ev,
          fair_prob_at_placement: taker.fairProb,
          bookmakers: taker.bookmakers,
          event_start_time: taker.eventStartTime
            ? new Date(taker.eventStartTime)
            : undefined,
        });
      } else {
        console.log(`   not filled: ${taker.marketSlug}`);
      }
    } catch (err: any) {
      console.error(`   taker error ${taker.marketSlug}:`, err.message);
    }

    await sleep(100);
  }
}

// ============================================================================
// MAKER PLACEMENT
// ============================================================================

async function placeNewMakers(
  makers: MakerOpportunity[],
  positionMap: Map<string, EnrichedPosition>,
): Promise<void> {
  if (makers.length === 0) {
    console.log("   No maker opportunities.");
    return;
  }

  const tracked = getTrackedMakerOrders();

  for (const maker of makers) {
    const currentShares = positionMap.get(maker.tokenId)?.shares ?? 0;
    const sharesToBuy = Math.max(
      0,
      maker.kellySize.constrainedShares - currentShares,
    );

    if (sharesToBuy < maker.minOrderSize) {
      console.log(
        `   skip ${maker.marketSlug} (${maker.outcomeName}): already own ${currentShares.toFixed(2)} shares`,
      );
      continue;
    }

    if (tracked.find((t) => t.tokenId === maker.tokenId)) {
      console.log(`   skip ${maker.marketSlug}: active maker already exists`);
      continue;
    }

    const adjusted: MakerOpportunity = {
      ...maker,
      kellySize: {
        ...maker.kellySize,
        constrainedShares: sharesToBuy,
        constrainedSizeUSD: sharesToBuy * maker.targetPrice,
      },
    };

    try {
      const result = await placeMakerOrder(adjusted, { dryRun: DRY_RUN });

      if (DRY_RUN) {
        console.log(`   [DRY] maker ${maker.marketSlug} (${maker.outcomeName}) EV=${(maker.ev * 100).toFixed(2)}%
  size=${sharesToBuy.toFixed(2)}@${(maker.targetPrice * 100).toFixed(1)}%`);
      } else if (result.orderId) {
        console.log(`   placed ${maker.marketSlug} order=${result.orderId}`);
        registerMakerOrder(
          result.orderId,
          adjusted,
          result.preview,
          adjusted.eventStartTime,
        );
      } else {
        console.log(`   placement failed: ${maker.marketSlug}`);
      }
    } catch (err: any) {
      console.error(`   maker error ${maker.marketSlug}:`, err.message);
    }

    await sleep(100);
  }
}

// ============================================================================
// MAKER EVALUATION
// ============================================================================

async function evaluateExistingMakers(
  makers: MakerOpportunity[],
  positionMap: Map<string, EnrichedPosition>,
  bucketExposure: Map<string, number>,
  totalCapital: number,
): Promise<void> {
  const tracked = getTrackedMakerOrders();
  if (tracked.length === 0) {
    console.log("   No makers to evaluate.");
    return;
  }

  const openOrders = await fetchOpenOrders();

  // Re-register any open orders for tokens we currently have opportunities on
  // (catches orders placed before this process started)
  const makersByToken = new Map(makers.map((m) => [m.tokenId, m]));
  for (const o of openOrders) {
    const opp = makersByToken.get(o.asset_id);
    if (!opp) continue;
    registerMakerOrder(
      o.id,
      opp,
      {
        tokenID: opp.tokenId,
        side: "BUY" as any,
        price: parseFloat(o.price ?? "0"),
        size: parseFloat(o.original_size ?? "0"),
        orderType: "GTC" as any,
      },
      opp.eventStartTime,
    );
  }

  const tokenIds = getTrackedMakerOrders().map((t) => t.tokenId);
  const livePrices = await fetchBestPricesForTokens(tokenIds);

  // Drop makers where positions already satisfy Kelly
  const makersForEval = makers.filter((m) => {
    const shares = positionMap.get(m.tokenId)?.shares ?? 0;
    return shares < m.kellySize.constrainedShares - 1e-6;
  });

  const decision = await evaluateMakerOrders(
    makersForEval,
    openOrders as any,
    totalCapital,
    bucketExposure,
    livePrices,
  );

  console.log(
    `   ${decision.cancelOrderIds.length} to cancel, ${decision.cleanedUpOrderIds.length} cleaned up`,
  );

  if (decision.cancelOrderIds.length > 0) {
    if (DRY_RUN) {
      decision.cancelOrderIds.forEach((id) =>
        console.log(`   [DRY] cancel ${id}`),
      );
    } else {
      const client = await getClobClient();
      for (const id of decision.cancelOrderIds) {
        try {
          await client.cancelOrder({ orderID: id });
          removeMakerOrder(id);
          console.log(`   cancelled ${id}`);
          await sleep(50);
        } catch (err: any) {
          console.error(`   cancel error ${id}:`, err.message);
        }
      }
    }
  }

  if (env.verbose) {
    for (const d of decision.details) {
      console.log(`   ${d.orderId.slice(0, 8)} ${d.action}: ${d.reasons[0]}`);
    }
  }
}

// ============================================================================
// MARKET STATE — cancel orders when games start
// ============================================================================

async function cancelStartedMarkets(
  markets: { marketSlug?: string; startTime: string }[],
): Promise<void> {
  const now = Date.now();
  const tracked = getTrackedMakerOrders();
  if (tracked.length === 0) return;

  const startTimes = new Map(
    markets
      .filter((m) => m.marketSlug)
      .map((m) => [m.marketSlug!, new Date(m.startTime).getTime()]),
  );

  const toCancel = tracked.filter((t) => {
    const st = startTimes.get(t.marketSlug);
    return st !== undefined && now >= st;
  });

  if (toCancel.length === 0) return;

  console.log(
    `\n[states] cancelling ${toCancel.length} orders for started games`,
  );

  if (DRY_RUN) {
    toCancel.forEach((t) => console.log(`   [DRY] cancel ${t.orderId}`));
    return;
  }

  const client = await getClobClient();
  for (const t of toCancel) {
    try {
      await client.cancelOrder({ orderID: t.orderId });
      removeMakerOrder(t.orderId);
      await sleep(50);
    } catch (err: any) {
      console.error(`   cancel error ${t.orderId}:`, err.message);
    }
  }
}

// ============================================================================
// MAIN CYCLE
// ============================================================================

async function runCycle(cycle: number): Promise<number> {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`CYCLE ${cycle} — ${new Date().toISOString()}`);
  console.log("=".repeat(70));

  const cycleStart = Date.now();

  try {
    // 1. Discover
    console.log("\n[1] Discovering markets...");
    const markets = await discoverPolymarkets();
    await enrichMarketsWithClobQuotes(markets);
    console.log(`    ${markets.length} markets`);
    if (markets.length === 0) return POLLING_INTERVAL_MS;

    // 2. Odds
    // 2. Odds
    console.log("\n[2] Fetching odds...");
    let oddsData: Awaited<ReturnType<typeof fetchOddsForMarkets>>;
    try {
      oddsData = await fetchOddsForMarkets(markets);
    } catch (err) {
      if (err instanceof OddsApiQuotaError) {
        console.warn("   [odds] quota exhausted — skipping this cycle");
        await evaluateExistingMakers([], new Map(), new Map(), env.bankrollUSD);
        return POLLING_INTERVAL_MS;
      }
      throw err;
    }

    // 3. Match
    console.log("\n[3] Matching...");
    const matched = matchMarkets(markets, oddsData);
    const matchedCount = matched.filter(
      (m) => Object.keys(m.sportsbooks).length > 0,
    ).length;
    console.log(`    ${matchedCount}/${matched.length} matched`);

    // 4. Capital
    console.log("\n[4] Capital & positions...");
    const wallet = await fetchWalletState();
    const rawPositions = await fetchCurrentPositions();
    const openOrders = await fetchOpenOrders();
    const capital = computeCapitalSummary(
      wallet.usdcBalance,
      rawPositions,
      openOrders,
    );
    console.log(`    $${capital.totalCapitalUSD.toFixed(2)} total (USDC: $${capital.usdcBalance.toFixed(2)}, positions:
  $${capital.totalPositionValueUSD.toFixed(2)})`);

    const enriched = buildEnrichedPositions(markets, rawPositions);
    const positionMap = buildPositionMap(enriched);

    const exposureSnapshots = buildExposureSnapshotsFromPositions(
      markets,
      rawPositions,
    );
    const bucketExposure = new Map<string, number>();
    for (const s of exposureSnapshots) {
      if (!s.bucketKey) continue;
      bucketExposure.set(
        s.bucketKey,
        (bucketExposure.get(s.bucketKey) ?? 0) + s.exposureUSD,
      );
    }

    // 5. Analyze
    console.log("\n[5] Analyzing...");
    const bankrollForKelly =
      capital.totalCapitalUSD > 0 ? capital.totalCapitalUSD : env.bankrollUSD;
    const opps = analyzeOpportunities(matched, bankrollForKelly);
    console.log(
      `    ${opps.takers.length} takers, ${opps.makers.length} makers`,
    );

    // CLV update for markets within closing window
    for (const m of opps.matched) {
      if (
        !m.polymarket.marketSlug ||
        m.fairProbOutcome1 === undefined ||
        !m.polymarket.startTime
      )
        continue;
      const timeToStart =
        new Date(m.polymarket.startTime).getTime() - Date.now();
      if (timeToStart > 0 && timeToStart <= 15 * 60 * 1000) {
        updateWagerCLV(
          m.polymarket.marketSlug,
          m.fairProbOutcome1,
          m.fairProbOutcome2,
        );
      }
    }

    // 6. Execute takers
    console.log("\n[6] Takers...");
    await executeTakers(opps.takers, positionMap);

    // 7. Place makers
    console.log("\n[7] New makers...");
    await placeNewMakers(opps.makers, positionMap);

    // 8. Track fills (live only)
    if (!DRY_RUN) {
      console.log("\n[8] Tracking fills...");
      await trackMakerFills();
    }

    // 9. Evaluate existing makers
    console.log("\n[9] Evaluating makers...");
    await evaluateExistingMakers(
      opps.makers,
      positionMap,
      bucketExposure,
      capital.totalCapitalUSD,
    );

    // 10. Cancel started games
    console.log("\n[10] Market states...");
    await cancelStartedMarkets(markets);

    const elapsed = ((Date.now() - cycleStart) / 1000).toFixed(1);
    console.log(`\n${"=".repeat(70)}`);
    console.log(
      `CYCLE ${cycle} done in ${elapsed}s — next in ${POLLING_INTERVAL_MS / 1000}s`,
    );

    return POLLING_INTERVAL_MS;
  } catch (err: any) {
    console.error("\n[cycle error]", err.message, err.stack);
    return POLLING_INTERVAL_MS;
  }
}

// ============================================================================
// STARTUP & SHUTDOWN
// ============================================================================

async function main(): Promise<void> {
  console.log(
    `\nPOLYBOT — mode: ${DRY_RUN ? "DRY RUN" : "LIVE"} — ${new Date().toISOString()}`,
  );

  if (!DRY_RUN) {
    console.log("\nWARNING: LIVE MODE — real orders will be placed.");
    console.log("Ctrl+C within 5 seconds to abort...\n");
    await sleep(5000);

    console.log("[startup] cancelling all open orders...");
    const client = await getClobClient();
    await client.cancelAll();

    const tracked = getTrackedMakerOrders();
    for (const t of tracked) removeMakerOrder(t.orderId);
    console.log(`[startup] cleared ${tracked.length} tracked orders`);
  }

  let cycle = 1;
  while (true) {
    const sleepMs = await runCycle(cycle++);
    await sleep(sleepMs);
  }
}

process.on("SIGINT", () => {
  console.log("\n[shutdown] SIGINT received");
  process.exit(0);
});
process.on("SIGTERM", () => {
  console.log("\n[shutdown] SIGTERM received");
  process.exit(0);
});

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
