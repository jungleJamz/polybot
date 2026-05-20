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
  const unauthed = new ClobClient("https://clob.polymarket.com", Chain.POLYGON, walletClient);
  const creds = await unauthed.deriveApiKey();
  const client = new ClobClient("https://clob.polymarket.com", Chain.POLYGON, walletClient, creds);

  // Try signature_type=3 as recommended by Polymarket support
  for (const sigType of [0, 1, 2, 3]) {
    try {
      await (client as any).get(`https://clob.polymarket.com/balance-allowance/update`, {
        headers: (client as any).buildHeaders?.() ?? {},
        params: { asset_type: AssetType.COLLATERAL, signature_type: sigType },
      });
    } catch {}
  }

  // Direct raw HTTP call with signature_type=3
  console.log("Calling raw sync with signature_type=3...");
  const unauthed2 = new ClobClient("https://clob.polymarket.com", Chain.POLYGON, walletClient, undefined, 3 as any);
  const creds2 = await unauthed2.deriveApiKey();
  const client3 = new ClobClient("https://clob.polymarket.com", Chain.POLYGON, walletClient, creds2, 3 as any);
  await client3.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL });
  const after3 = await client3.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
  console.log("sig_type=3 balance:", JSON.stringify(after3));

  // Also check with our existing client (sig_type=0)
  console.log("\nCurrent balance (sig_type=0):");
  const current = await client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
  console.log(JSON.stringify(current));
}

main().catch(console.error);
