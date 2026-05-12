export interface OpportunitySummary {
  slug: string;
  ev: number;
  size: number;
  price: number;
}

export interface DashboardState {
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

export const state: DashboardState = {
  mode: "DRY RUN",
  startedAt: new Date().toISOString(),
  cycleNumber: 0,
  lastCycleAt: null,
  lastCycleSec: null,
  discovery: null,
  matching: null,
  capital: null,
  takers: [],
  makers: [],
  quotaExhausted: false,
  logs: [],
};

export function addLog(msg: string): void {
  state.logs.unshift(`[${new Date().toLocaleTimeString()}] ${msg}`);
  if (state.logs.length > 50) state.logs.pop();
}
