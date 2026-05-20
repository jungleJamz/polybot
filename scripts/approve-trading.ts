/**
 * Check and set on-chain USDC approvals for Polymarket exchange contracts.
 * Run with --approve flag to actually execute the transactions.
 *
 * Usage:
 *   npx tsx scripts/approve-trading.ts          (check only)
 *   npx tsx scripts/approve-trading.ts --approve (check + approve)
 */
import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseAbi, maxUint256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";

const key = process.env.POLY_PRIVATE_KEY!.startsWith("0x")
  ? (process.env.POLY_PRIVATE_KEY! as `0x${string}`)
  : (`0x${process.env.POLY_PRIVATE_KEY}` as `0x${string}`);

const account = privateKeyToAccount(key);
const publicClient = createPublicClient({ chain: polygon, transport: http() });
const walletClient = createWalletClient({ account, chain: polygon, transport: http() });

// Native USDC on Polygon (what the CLOB uses)
const USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" as `0x${string}`;

// Polymarket exchange contracts that need approval
const SPENDERS = [
  { name: "CTF Exchange",          address: "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E" as `0x${string}` },
  { name: "Neg Risk CTF Exchange", address: "0xC5d563A36AE78145C45a50134d48A1215220f80a" as `0x${string}` },
  { name: "Neg Risk Adapter",      address: "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296" as `0x${string}` },
];

const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

async function main() {
  const doApprove = process.argv.includes("--approve");

  console.log("\n=== Polymarket Trading Approvals ===");
  console.log("Wallet:", account.address);

  const balance = await publicClient.readContract({
    address: USDC, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address],
  });
  console.log(`USDC balance: $${(Number(balance) / 1e6).toFixed(2)}\n`);

  const needsApproval: typeof SPENDERS = [];

  for (const spender of SPENDERS) {
    const allowance = await publicClient.readContract({
      address: USDC, abi: ERC20_ABI, functionName: "allowance",
      args: [account.address, spender.address],
    });
    const isUnlimited = allowance > BigInt("1000000000000000000"); // > 1 trillion
    const usd = (Number(allowance) / 1e6).toFixed(2);
    const status = isUnlimited ? "✅ Unlimited" : allowance > 0n ? `⚠️  $${usd}` : "❌ None";
    console.log(`${spender.name}: ${status}`);
    if (!isUnlimited) needsApproval.push(spender);
  }

  if (needsApproval.length === 0) {
    console.log("\n✅ All approvals set — CLOB trading is authorized.");
    return;
  }

  console.log(`\n${needsApproval.length} contract(s) need approval.`);

  if (!doApprove) {
    console.log("Run with --approve to execute the transactions:");
    console.log("  npx tsx scripts/approve-trading.ts --approve");
    return;
  }

  console.log("\nExecuting approvals (requires POL for gas)...");
  for (const spender of needsApproval) {
    try {
      console.log(`\nApproving ${spender.name}...`);
      const hash = await walletClient.writeContract({
        address: USDC, abi: ERC20_ABI, functionName: "approve",
        args: [spender.address, maxUint256],
      });
      console.log(`  TX: ${hash}`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      console.log(`  ✅ Confirmed in block ${receipt.blockNumber}`);
    } catch (err: any) {
      console.log(`  ❌ Failed: ${err.message}`);
    }
  }

  console.log("\nDone. Re-run without --approve to verify.");
}

main().catch(console.error);
