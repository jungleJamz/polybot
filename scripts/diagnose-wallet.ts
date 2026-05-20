import "dotenv/config";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { Chain, ClobClient, AssetType } from "@polymarket/clob-client";

const key = process.env.POLY_PRIVATE_KEY!.startsWith("0x")
  ? process.env.POLY_PRIVATE_KEY!
  : `0x${process.env.POLY_PRIVATE_KEY}`;

const proxyWallet = process.env.POLY_PROXY_WALLET!;
const account = privateKeyToAccount(key as `0x${string}`);

console.log("\n=== ADDRESSES ===");
console.log("EOA (your Phantom address):    ", account.address);
console.log("POLY_PROXY_WALLET in .env:     ", proxyWallet);

const walletClient = createWalletClient({ account, chain: polygon, transport: http() });

// Try sig type 1 (EOA is the funder — no proxy)
async function trySignatureType(sigType: number, funder: string | undefined) {
  console.log(`\n--- sig type ${sigType}, funder: ${funder ?? "none"} ---`);
  try {
    const client = new ClobClient(
      "https://clob.polymarket.com",
      Chain.POLYGON,
      walletClient,
      undefined,
      sigType as any,
      funder,
    );
    const creds = await client.deriveApiKey();
    console.log("deriveApiKey response:", JSON.stringify(creds, null, 2));

    if (creds?.secret) {
      const authed = new ClobClient(
        "https://clob.polymarket.com",
        Chain.POLYGON,
        walletClient,
        creds,
        sigType as any,
        funder,
      );
      const bal = await authed.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
      console.log("getBalanceAllowance:", JSON.stringify(bal, null, 2));
    } else {
      console.log("No valid creds returned — this sig type / funder combo is wrong");
    }
  } catch (err: any) {
    console.log("Error:", err.message);
  }
}

import { createPublicClient } from "viem";

const publicClient = createPublicClient({ chain: polygon, transport: http() });

const ERC20_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// Native USDC on Polygon (Circle-issued)
const USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" as `0x${string}`;
// Bridged USDC.e on Polygon
const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as `0x${string}`;

async function checkOnChainBalance(label: string, address: `0x${string}`) {
  console.log(`\n--- on-chain balances for ${label} (${address}) ---`);
  const [usdc, usdce] = await Promise.all([
    publicClient.readContract({ address: USDC, abi: ERC20_ABI, functionName: "balanceOf", args: [address] }),
    publicClient.readContract({ address: USDC_E, abi: ERC20_ABI, functionName: "balanceOf", args: [address] }),
  ]);
  console.log(`USDC (native):   $${(Number(usdc) / 1e6).toFixed(2)}`);
  console.log(`USDC.e (bridged): $${(Number(usdce) / 1e6).toFixed(2)}`);
}

async function checkClobBalance() {
  console.log(`\n--- CLOB balance (new approach: no sig type, no proxy) ---`);
  try {
    const walletClient = createWalletClient({
      account,
      chain: polygon,
      transport: http(),
    });
    const client = new ClobClient("https://clob.polymarket.com", Chain.POLYGON, walletClient);
    const creds = await client.deriveApiKey();
    console.log("API key:", creds?.key);
    if (creds?.secret) {
      const authed = new ClobClient("https://clob.polymarket.com", Chain.POLYGON, walletClient, creds);
      const bal = await authed.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
      console.log("getBalanceAllowance:", JSON.stringify(bal, null, 2));
    }
  } catch (err: any) {
    console.log("Error:", err.message);
  }
}

async function main() {
  await checkOnChainBalance("EOA (Phantom)", account.address as `0x${string}`);
  await checkOnChainBalance("POLY_PROXY_WALLET", proxyWallet as `0x${string}`);
  await checkClobBalance();
}

main().catch(console.error);
