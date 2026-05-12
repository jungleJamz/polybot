import db from "./db.js";

export interface Wager {
  order_id: string;
  token_id: string;
  market_slug: string;
  event_slug: string;
  sport: string;
  market_type: string;
  outcome: 1 | 2;
  side: "BUY";
  order_type: "MAKER" | "TAKER";
  price: number;
  size_filled: number;
  ev_at_placement: number;
  fair_prob_at_placement: number;
  bookmakers: string[];
  event_start_time?: Date | null;
}

export function saveWager(wager: Wager): void {
  db.prepare(
    `
      INSERT INTO wagers
        (order_id, token_id, market_slug, event_slug, sport, market_type,
         outcome, side, order_type, price, size_filled, ev_at_placement,
         fair_prob_at_placement, bookmakers_used, event_start_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    wager.order_id,
    wager.token_id,
    wager.market_slug,
    wager.event_slug,
    wager.sport,
    wager.market_type,
    wager.outcome,
    wager.side,
    wager.order_type,
    wager.price,
    wager.size_filled,
    wager.ev_at_placement,
    wager.fair_prob_at_placement,
    JSON.stringify(wager.bookmakers),
    wager.event_start_time?.toISOString() ?? null,
  );
}

export function updateWagerSize(orderId: string, newTotalSize: number): void {
  db.prepare(`UPDATE wagers SET size_filled = ? WHERE order_id = ?`).run(
    newTotalSize,
    orderId,
  );
}

export function getWagerByOrderId(orderId: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM wagers WHERE order_id = ? LIMIT 1`)
    .get(orderId);
  return row !== undefined;
}

export function updateWagerCLV(
  marketSlug: string,
  closingFairProb1: number,
  closingFairProb2?: number,
): void {
  const wagers = db
    .prepare(`SELECT id, price, outcome FROM wagers WHERE market_slug = ?`)
    .all(marketSlug) as any[];

  const update = db.prepare(
    `UPDATE wagers SET closing_fair_prob = ?, clv = ? WHERE id = ?`,
  );

  // Run all CLV updates in one transaction for atomicity + performance
  const updateAll = db.transaction((rows: any[]) => {
    for (const w of rows) {
      const fairProb =
        w.outcome === 1
          ? closingFairProb1
          : (closingFairProb2 ?? 1 - closingFairProb1);
      const clv = (fairProb - Number(w.price)) / Number(w.price);
      update.run(fairProb, clv, w.id);
    }
  });

  updateAll(wagers);
}
