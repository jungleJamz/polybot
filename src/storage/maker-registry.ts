import db from "./db.js";
import type { MakerOpportunity } from "../types.js";
import type { ExecutionPreview } from "../arb/execution.js";

export interface TrackedMakerOrder {
  orderId: string;
  tokenId: string;
  marketSlug: string;
  eventSlug: string;
  sport: string;
  marketType: string;
  outcome: 1 | 2;
  targetPrice: number;
  size: number;
  evAtPlacement: number;
  fairProbAtPlacement: number;
  bookmakers: string[];
  placedAt: number; // ms since epoch
  eventStartTime?: string;
}

export function registerMakerOrder(
  orderId: string,
  opp: MakerOpportunity,
  preview: ExecutionPreview,
  eventStartTime?: string,
): void {
  db.prepare(
    `
      INSERT INTO active_maker_orders
        (order_id, token_id, market_slug, event_slug, sport, market_type,
         outcome, target_price, size, ev_at_placement, fair_prob_at_placement,
         bookmakers_used, placed_at, event_start_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(order_id) DO UPDATE SET
        target_price = excluded.target_price,
        size         = excluded.size
    `,
  ).run(
    orderId,
    opp.tokenId,
    opp.marketSlug,
    opp.eventSlug,
    opp.sport,
    opp.marketType,
    opp.outcome,
    preview.price,
    preview.size,
    opp.ev,
    opp.fairProb,
    JSON.stringify(opp.bookmakers),
    new Date().toISOString(),
    eventStartTime ?? null,
  );
}

export function removeMakerOrder(orderId: string): void {
  db.prepare(`DELETE FROM active_maker_orders WHERE order_id = ?`).run(orderId);
}

export function getTrackedMakerOrders(): TrackedMakerOrder[] {
  const rows = db.prepare(`SELECT * FROM active_maker_orders`).all() as any[];
  return rows.map((row) => ({
    orderId: row.order_id,
    tokenId: row.token_id,
    marketSlug: row.market_slug,
    eventSlug: row.event_slug,
    sport: row.sport,
    marketType: row.market_type,
    outcome: row.outcome as 1 | 2,
    targetPrice: Number(row.target_price),
    size: Number(row.size),
    evAtPlacement: Number(row.ev_at_placement),
    fairProbAtPlacement: Number(row.fair_prob_at_placement),
    bookmakers: JSON.parse(row.bookmakers_used),
    placedAt: new Date(row.placed_at).getTime(),
    eventStartTime: row.event_start_time ?? undefined,
  }));
}
