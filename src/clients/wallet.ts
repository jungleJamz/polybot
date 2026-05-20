import { AssetType } from "@polymarket/clob-client";
import { getClobClient } from "./clob.js";

export interface WalletState {
  usdcBalance: number;
  usdcAllowance: number;
}

// USDC on Polygon has 6 decimals — raw balance "5000000" = 5.00 USDC
function parseBalance(value: string | number | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export async function fetchWalletState(): Promise<WalletState> {
  const client = await getClobClient();
  await client.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL });
  const resp = await client.getBalanceAllowance({
    asset_type: AssetType.COLLATERAL,
  });
  // API returns allowances as an object keyed by spender address; sum all entries
  const raw = resp as any;
  const totalAllowance = raw.allowances
    ? Object.values(raw.allowances as Record<string, string>).reduce(
        (sum, v) => sum + parseBalance(v),
        0,
      )
    : parseBalance((resp as any).allowance);

  return {
    usdcBalance: parseBalance(resp.balance) / 1_000_000,
    usdcAllowance: totalAllowance / 1_000_000,
  };
}

export async function getBankrollUSD(): Promise<number> {
  const { usdcBalance } = await fetchWalletState();
  return usdcBalance;
}
