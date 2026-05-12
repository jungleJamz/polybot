import { Side, OrderType } from "@polymarket/clob-client";
import { getClobClient } from "../clients/clob.js";
import type { TakerOpportunity, MakerOpportunity } from "../types.js";

export interface ExecutionOptions {
  dryRun?: boolean; // default: true
}

export interface ExecutionPreview {
  tokenID: string;
  side: Side;
  price: number;
  size: number;
  orderType: OrderType;
}

export interface ExecutionResult {
  filled: boolean;
  orderId?: string;
  response?: any;
  preview: ExecutionPreview;
}

// FAK = Fill-And-Kill (IOC): hits the ask immediately, cancels any unfilled remainder.
// Never rests on the book — no slippage risk.
export async function executeTakerOrder(
  opp: TakerOpportunity,
  options?: ExecutionOptions,
): Promise<ExecutionResult> {
  const dryRun = options?.dryRun !== false;
  const size = Math.max(
    opp.minOrderSize,
    Math.floor(opp.kellySize.constrainedShares),
  );
  const price = Number(opp.polymarketAsk.toFixed(2));
  const preview: ExecutionPreview = {
    tokenID: opp.tokenId,
    side: Side.BUY,
    price,
    size,
    orderType: OrderType.FAK,
  };

  if (dryRun) return { filled: false, preview };

  const client = await getClobClient();
  const signedOrder = await client.createOrder({
    tokenID: opp.tokenId,
    price,
    size,
    side: Side.BUY,
  });
  const resp = await client.postOrder(signedOrder, OrderType.FAK);

  const status: string | undefined = resp?.status;
  const orderId: string | undefined =
    resp?.orderID ?? resp?.orderId ?? resp?.id;
  const filled =
    status === "MATCHED" ||
    status === "FILLED" ||
    status === "COMPLETED" ||
    resp?.success === true;

  return { filled, orderId, response: resp, preview };
}

// GTC = Good-Till-Cancelled: posts a resting bid at targetPrice.
// Stays on the book until filled, cancelled by us, or the bot shuts down.
export async function placeMakerOrder(
  opp: MakerOpportunity,
  options?: ExecutionOptions,
): Promise<ExecutionResult> {
  const dryRun = options?.dryRun !== false;
  // Round to 2dp (not whole shares) — precision matters for resting bids
  const size = Math.max(
    opp.minOrderSize,
    Math.floor(opp.kellySize.constrainedShares * 100) / 100,
  );
  const price = opp.targetPrice;
  const preview: ExecutionPreview = {
    tokenID: opp.tokenId,
    side: Side.BUY,
    price,
    size,
    orderType: OrderType.GTC,
  };

  if (dryRun) return { filled: false, preview };

  const client = await getClobClient();
  const signedOrder = await client.createOrder({
    tokenID: opp.tokenId,
    price,
    size,
    side: Side.BUY,
  });
  const resp = await client.postOrder(signedOrder, OrderType.GTC);

  const status: string | undefined = resp?.status;
  const orderId: string | undefined =
    resp?.orderID ?? resp?.orderId ?? resp?.id;
  const filled =
    status === "MATCHED" ||
    status === "FILLED" ||
    status === "COMPLETED" ||
    resp?.success === true;

  return { filled, orderId, response: resp, preview };
}
