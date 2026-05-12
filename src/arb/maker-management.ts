import type { OpenOrder } from "@polymarket/clob-client";
import type { MakerOpportunity } from "../types.js";
import type { BestPrices } from "./orderbook.js";
import {
  getTrackedMakerOrders,
  removeMakerOrder,
} from "../storage/maker-registry.js";
import {
  MAKER_MARGINS,
  MAKER_EVAL_EV_DROP,
  MAX_PER_BUCKET_FRACTION,
} from "../config.js";
import type { TrackedMakerOrder } from "../storage/maker-registry.js";

export interface MakerEvaluationDecision {
  cancelOrderIds: string[];
  cleanedUpOrderIds: string[];
  details: MakerOrderDecisionDetail[];
}

export type MakerOrderAction = "keep" | "cancel" | "cleanup";

export interface MakerOrderDecisionDetail {
  orderId: string;
  tokenId: string;
  marketSlug: string;
  outcome: 1 | 2;
  currentEV: number | null;
  evAtPlacement: number;
  minEV: number;
  evDrop: number;
  outbidBy: number;
  action: MakerOrderAction;
  reasons: string[];
}

export async function evaluateMakerOrders(
  currentMakers: MakerOpportunity[],
  openOrders: OpenOrder[],
  totalCapitalUsd: number,
  bucketExposureByKey: Map<string, number>,
  liveBestPrices?: Map<string, BestPrices>,
): Promise<MakerEvaluationDecision> {
  const tracked: TrackedMakerOrder[] = getTrackedMakerOrders();
  const maxBucketUsd = totalCapitalUsd * MAX_PER_BUCKET_FRACTION;

  const openById = new Map(openOrders.map((o) => [o.id, o]));
  const makersByToken = new Map(currentMakers.map((m) => [m.tokenId, m]));

  const cancelOrderIds: string[] = [];
  const cleanedUpOrderIds: string[] = [];
  const details: MakerOrderDecisionDetail[] = [];

  for (const t of tracked) {
    const open = openById.get(t.orderId);

    if (!open) {
      removeMakerOrder(t.orderId);
      cleanedUpOrderIds.push(t.orderId);
      details.push({
        orderId: t.orderId,
        tokenId: t.tokenId,
        marketSlug: t.marketSlug,
        outcome: t.outcome,
        currentEV: null,
        evAtPlacement: t.evAtPlacement,
        minEV: 0,
        evDrop: 0,
        outbidBy: 0,
        action: "cleanup",
        reasons: ["Order no longer open on CLOB."],
      });
      continue;
    }

    const opp = makersByToken.get(t.tokenId);

    if (!opp) {
      cancelOrderIds.push(t.orderId);
      details.push({
        orderId: t.orderId,
        tokenId: t.tokenId,
        marketSlug: t.marketSlug,
        outcome: t.outcome,
        currentEV: null,
        evAtPlacement: t.evAtPlacement,
        minEV: 0,
        evDrop: 0,
        outbidBy: 0,
        action: "cancel",
        reasons: ["No current opportunity for this token (out of model)."],
      });
      continue;
    }

    const currentEV = opp.ev;
    const openPrice = parseFloat(open.price);
    const filledShares = parseFloat(open.size_matched ?? "0");
    const kellyTarget = opp.kellySize.constrainedShares;

    const live = liveBestPrices?.get(t.tokenId);
    const bestBid =
      live?.bestBid != null && Number.isFinite(live.bestBid)
        ? live.bestBid
        : (opp.currentBid ?? openPrice);

    const outbidBy = bestBid - openPrice;
    const outbidByTick = opp.tickSize > 0 && outbidBy >= opp.tickSize - 1e-9;

    // minEV comes from MAKER_MARGINS — marketType already encodes _h1
    const minEV =
      MAKER_MARGINS[opp.marketType as keyof typeof MAKER_MARGINS]?.min ?? 0.03;
    const evTooLow = currentEV < minEV;
    const evDropped = currentEV < t.evAtPlacement - MAKER_EVAL_EV_DROP;
    const evDrop = currentEV - t.evAtPlacement;
    const bucketExposure = bucketExposureByKey.get(opp.bucketKey) ?? 0;
    const bucketAtLimit = bucketExposure >= maxBucketUsd - 1e-8;
    const kellySatisfied =
      Number.isFinite(kellyTarget) &&
      kellyTarget > 0 &&
      filledShares >= kellyTarget - 1e-8;

    const reasons: string[] = [];
    let action: MakerOrderAction = "keep";

    if (kellySatisfied) {
      action = "cancel";
      reasons.push(
        `Filled ${filledShares.toFixed(2)} >= Kelly target ${kellyTarget.toFixed(2)}.`,
      );
    } else if (bucketAtLimit) {
      action = "cancel";
      reasons.push(
        `Bucket exposure $${bucketExposure.toFixed(2)} at limit $${maxBucketUsd.toFixed(2)}.`,
      );
    } else if (outbidByTick) {
      action = "cancel";
      reasons.push(
        `Outbid by ${outbidBy.toFixed(4)} (≥1 tick). EV ${currentEV.toFixed(4)}.`,
      );
    } else if (evTooLow) {
      action = "cancel";
      reasons.push(`EV ${currentEV.toFixed(4)} < minEV ${minEV.toFixed(4)}.`);
    } else if (evDropped) {
      action = "cancel";
      reasons.push(
        `EV dropped ${evDrop.toFixed(4)} > threshold -${MAKER_EVAL_EV_DROP}.`,
      );
    } else {
      reasons.push(
        `EV ${currentEV.toFixed(4)} OK, not outbid, filled ${filledShares.toFixed(2)}/${kellyTarget.toFixed(2)}.`,
      );
    }
    if (action === "cancel") cancelOrderIds.push(t.orderId);

    details.push({
      orderId: t.orderId,
      tokenId: t.tokenId,
      marketSlug: t.marketSlug,
      outcome: t.outcome,
      currentEV,
      evAtPlacement: t.evAtPlacement,
      minEV,
      evDrop,
      outbidBy,
      action,
      reasons,
    });
  }

  return { cancelOrderIds, cleanedUpOrderIds, details };
}
