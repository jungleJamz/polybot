/**
 * Read the user's balance directly from the Relay: Depository contract
 * to confirm funds are attributed to the correct address.
 */
import "dotenv/config";
import { createPublicClient, http, parseAbi } from "viem";
import { polygon } from "viem/chains";

const RELAY = "0x4cD00E387622C35bDDB9b4c962C136462338BC31" as `0x${string}`;
const EOA   = "0xec32908599F9F57cf78F83fc9ED42ef2f6070c3a" as `0x${string}`;

const client = createPublicClient({ chain: polygon, transport: http() });

async function tryRead(functionSig: string, args: any[]) {
  try {
    const result = await client.readContract({
      address: RELAY,
      abi: parseAbi([functionSig]),
      functionName: functionSig.match(/function (\w+)/)?.[1] ?? "",
      args,
    });
    return result;
  } catch {
    return null;
  }
}

async function main() {
  console.log("Relay: Depository:", RELAY);
  console.log("Your EOA:         ", EOA);
  console.log("");

  // Try common balance/deposit query patterns
  const attempts = [
    { sig: "function balanceOf(address) view returns (uint256)",       args: [EOA] },
    { sig: "function getBalance(address) view returns (uint256)",      args: [EOA] },
    { sig: "function deposits(address) view returns (uint256)",        args: [EOA] },
    { sig: "function collateral(address) view returns (uint256)",      args: [EOA] },
    { sig: "function balances(address) view returns (uint256)",        args: [EOA] },
  ];

  for (const { sig, args } of attempts) {
    const name = sig.match(/function (\w+)/)?.[1];
    const result = await tryRead(sig, args);
    if (result !== null) {
      const usd = (Number(result as bigint) / 1e6).toFixed(2);
      console.log(`${name}(EOA) = ${result} → $${usd}`);
    } else {
      console.log(`${name}(EOA) = (not found / reverted)`);
    }
  }

  // Also check the contract's source — what functions exist?
  console.log("\nChecking ABI via Polygonscan...");
  try {
    const res = await fetch(
      `https://api.polygonscan.com/api?module=contract&action=getabi&address=${RELAY}`
    );
    const json = await res.json() as any;
    if (json.status === "1") {
      const abi = JSON.parse(json.result);
      const fns = abi.filter((x: any) => x.type === "function").map((x: any) => x.name);
      console.log("Contract functions:", fns.join(", "));
    } else {
      console.log("ABI not verified on Polygonscan:", json.message);
    }
  } catch (e: any) {
    console.log("Polygonscan fetch failed:", e.message);
  }
}

main().catch(console.error);
