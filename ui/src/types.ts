export interface OpportunitySummary {
  slug: string;
  ev: number;
  size: number;
  price: number;
  startTime?: string;
}

export interface BotState {
  mode: string;
  startedAt: string;
  cycleNumber: number;
  lastCycleAt: string | null;
  lastCycleSec: number | null;
  discovery: { events: number; markets: number } | null;
  matching: { matched: number; total: number } | null;
  capital: { total: number; usdc: number; positions: number } | null;
  takers: OpportunitySummary[];
  makers: OpportunitySummary[];
  quotaExhausted: boolean;
  logs: string[];
}
