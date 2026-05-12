import { getClobClient } from "../clients/clob.js";
import { getTrackedMakerOrders } from "./maker-registry.js";
import { getWagerByOrderId, saveWager, updateWagerSize } from "./operations.js";
import type { TrackedMakerOrder } from "./maker-registry.js";

export async function trackMakerFills(): Promise<void> {
  const tracked = getTrackedMakerOrders();
  if (tracked.length === 0) return;

  const client = await getClobClient();

  try {
    const openOrders = await client.getOpenOrders({}, true);
    const openById = new Map(openOrders.map((o) => [o.id, o]));
    const processed = new Set<string>();

    // Update partially-filled orders still open on the CLOB
    for (const trackedOrder of tracked) {
      const open = openById.get(trackedOrder.orderId);
      if (!open) continue;
      processed.add(trackedOrder.orderId);
      const sizeMatched = parseFloat(open.size_matched ?? "0");
      if (sizeMatched > 0) await updateOrInsertWager(trackedOrder, sizeMatched);
    }

    // Check orders that disappeared from the open list — may have fully filled
    const missing = tracked.filter((t) => !processed.has(t.orderId));
    for (const t of missing) {
      try {
        const status = await client.getOrder(t.orderId);
        const sizeMatched = status ? parseFloat(status.size_matched ?? "0") : 0;
        if (sizeMatched > 0) await updateOrInsertWager(t, sizeMatched);
      } catch {
        // 404 or stale order — skip silently
      }
    }
  } catch (err: any) {
    console.error("[tracking] fill tracking error:", err.message);
  }
}

async function updateOrInsertWager(
  t: TrackedMakerOrder,
  sizeMatched: number,
): Promise<void> {
  if (getWagerByOrderId(t.orderId)) {
    updateWagerSize(t.orderId, sizeMatched);
  } else {
    saveWager({
      order_id: t.orderId,
      token_id: t.tokenId,
      market_slug: t.marketSlug,
      event_slug: t.eventSlug,
      sport: t.sport,
      market_type: t.marketType,
      outcome: t.outcome,
      side: "BUY",
      order_type: "MAKER",
      price: t.targetPrice,
      size_filled: sizeMatched,
      ev_at_placement: t.evAtPlacement,
      fair_prob_at_placement: t.fairProbAtPlacement,
      bookmakers: t.bookmakers,
      event_start_time: t.eventStartTime
        ? new Date(t.eventStartTime)
        : undefined,
    });
  }
}
