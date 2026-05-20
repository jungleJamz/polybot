/**
 * Raw HTTP call to Polymarket CLOB balance endpoints.
 * Tries all asset types and checks the raw response.
 */
import "dotenv/config";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { Chain, ClobClient, AssetType, SignatureType } from "@polymarket/clob-client";

const key = process.env.POLY_PRIVATE_KEY!.startsWith("0x")
  ? process.env.POLY_PRIVATE_KEY! as `0x${string}`
  : `0x${process.env.POLY_PRIVATE_KEY}` as `0x${string}`;

const account = privateKeyToAccount(key);
const walletClient = createWalletClient({ account, chain: polygon, transport: http() });

async function main() {
  const unauthed = new ClobClient("https://clob.polymarket.com", Chain.POLYGON, walletClient);
  const creds = await unauthed.deriveApiKey();
  const client = new ClobClient("https://clob.polymarket.com", Chain.POLYGON, walletClient, creds);

  // Try all possible asset types (0=collateral, 1=conditional)
  for (const assetType of [AssetType.COLLATERAL, AssetType.CONDITIONAL]) {
    try {
      console.log(`\n--- asset_type=${assetType} ---`);
      const upd = await client.updateBalanceAllowance({ asset_type: assetType });
      console.log("update response:", JSON.stringify(upd));
      const bal = await client.getBalanceAllowance({ asset_type: assetType });
      console.log("get response:", JSON.stringify(bal));
    } catch (e: any) {
      console.log("error:", e.message);
    }
  }

  // Also check trades and open orders for any account history
  console.log("\n--- trades (last 10) ---");
  const trades = await client.getTrades({ maker_address: account.address }, false);
  console.log(JSON.stringify(trades).slice(0, 500));

  console.log("\n--- open orders ---");
  const orders = await client.getOpenOrders();
  console.log(JSON.stringify(orders).slice(0, 500));
}

main().catch(console.error);
