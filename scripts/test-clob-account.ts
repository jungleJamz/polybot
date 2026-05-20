/**
 * Test if the CLOB account is fully recognized and can trade.
 */
import "dotenv/config";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { Chain, ClobClient, AssetType } from "@polymarket/clob-client";

const key = process.env.POLY_PRIVATE_KEY!.startsWith("0x")
  ? process.env.POLY_PRIVATE_KEY! as `0x${string}`
  : `0x${process.env.POLY_PRIVATE_KEY}` as `0x${string}`;

const account = privateKeyToAccount(key);
const walletClient = createWalletClient({ account, chain: polygon, transport: http() });

async function main() {
  console.log("EOA:", account.address);

  const unauthed = new ClobClient("https://clob.polymarket.com", Chain.POLYGON, walletClient);
  const creds = await unauthed.deriveApiKey();
  const client = new ClobClient("https://clob.polymarket.com", Chain.POLYGON, walletClient, creds);

  console.log("API key:", creds.key);

  // Check COLLATERAL balance (native USDC)
  const collateral = await client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
  console.log("\nCOLLATERAL balance:", JSON.stringify(collateral));

  // Check CONDITIONAL balance (shares/tokens)
  try {
    const conditional = await client.getBalanceAllowance({ asset_type: AssetType.CONDITIONAL });
    console.log("CONDITIONAL balance:", JSON.stringify(conditional));
  } catch (e: any) {
    console.log("CONDITIONAL balance: error -", e.message);
  }

  // List open orders — confirms the account is recognized
  try {
    const orders = await client.getOpenOrders();
    console.log("\nOpen orders:", Array.isArray(orders) ? orders.length : JSON.stringify(orders));
  } catch (e: any) {
    console.log("Open orders error:", e.message);
  }

  // List recent trades
  try {
    const trades = await (client as any).getTrades?.() ?? "method not available";
    console.log("Trades:", typeof trades === "string" ? trades : JSON.stringify(trades).slice(0, 200));
  } catch (e: any) {
    console.log("Trades error:", e.message);
  }

  // Raw HTTP call to balance endpoint to see full response
  console.log("\n--- Raw HTTP balance check ---");
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = await walletClient.signMessage({ message: ts });
  const headers = {
    "POLY-ADDRESS": account.address,
    "POLY-SIGNATURE": sig,
    "POLY-TIMESTAMP": ts,
    "POLY-API-KEY": creds.key,
    "POLY-PASSPHRASE": creds.passphrase,
  };
  const res = await fetch(
    "https://clob.polymarket.com/balance-allowance?asset_type=collateral",
    { headers }
  );
  console.log("Status:", res.status);
  console.log("Body:", await res.text());
}

main().catch(console.error);
