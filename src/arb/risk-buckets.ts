import type { PolymarketMarket, OutcomeIndex } from "../types.js";

export function normalizeBucketPart(value: string): string {
return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-");
}

function getBaseScope(marketType: string): string {
return marketType.endsWith("_h1") ? "h1" : "full";
}

export function getCorrelationBucketKey(
market: PolymarketMarket,
outcome: OutcomeIndex,
): string {
const event = normalizeBucketPart(market.eventSlug);
const scope = getBaseScope(market.marketType);
const base = `event:${event}:scope:${scope}`;

if (market.marketType === "totals" || market.marketType === "totals_h1") {
    return `${base}:total`;
}

const teamName = outcome === 1 ? market.outcome1Name : market.outcome2Name;
const team = normalizeBucketPart(teamName);
return `${base}:side:${team || "unknown"}`;
}