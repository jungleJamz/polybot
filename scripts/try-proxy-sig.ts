/**
 * Try POLY_PROXY (sig type 1) with different funder addresses
 * to find which combination the CLOB recognizes as having funds.
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

const EOA        = account.address;
const API_SIGNER = "0x8B31e468136Dc889317A5Edb6153BEDbf1c1B9e4";
const RELAY      = "0x4cD00E387622C35bDDB9b4c962C136462338BC31";

async function tryWithFunder(label: string, sigType: SignatureType, funder?: string) {
  try {
    const unauthed = new ClobClient("https://clob.polymarket.com", Chain.POLYGON, walletClient, undefined, sigType, funder);
    const creds = await unauthed.deriveApiKey();
    const client = new ClobClient("https://clob.polymarket.com", Chain.POLYGON, walletClient, creds, sigType, funder);

    await client.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL });
    const bal = await client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
    const balance = (bal as any).balance ?? "?";
    console.log(`${label}: balance=${balance}`);
    if (Number(balance) > 0) console.log("  ✅ FOUND FUNDS:", JSON.stringify(bal));
  } catch (e: any) {
    console.log(`${label}: ERROR - ${e.message}`);
  }
}

async function main() {
  console.log("EOA:", EOA);
  console.log("");
  await tryWithFunder("EOA (sig 0)",           SignatureType.EOA,             undefined);
  await tryWithFunder("POLY_PROXY, funder=EOA",       SignatureType.POLY_PROXY,    EOA);
  await tryWithFunder("POLY_PROXY, funder=API_SIGNER", SignatureType.POLY_PROXY,   API_SIGNER);
  await tryWithFunder("POLY_PROXY, funder=RELAY",      SignatureType.POLY_PROXY,   RELAY);
}

main().catch(console.error);
