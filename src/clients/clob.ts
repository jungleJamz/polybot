import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { Chain, ClobClient } from "@polymarket/clob-client";
import { env } from "../config.js";

async function initClobClient(): Promise<ClobClient> {
  const account = privateKeyToAccount(env.polyPrivateKey as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: polygon,
    transport: http(),
  });

  // Polymarket account type 3 — the "deposit wallet" account type used by
  // accounts created via the web UI. Types 0/1/2 return 0 balance for these accounts.
  const SIG_TYPE = env.polySignatureType as any;

  // First pass: no creds — used only to derive the API key
  const unauthClient = new ClobClient(env.clobApiUrl, Chain.POLYGON, walletClient, undefined, SIG_TYPE);

  let creds: any;
  try {
    creds = await unauthClient.deriveApiKey();
  } catch {
    // First-time wallet — fall back to create
  }

  if (!creds?.secret) {
    try {
      creds = await unauthClient.createOrDeriveApiKey();
    } catch (err: any) {
      throw new Error(`Failed to obtain CLOB API credentials: ${err.message}`);
    }
  }

  if (!creds?.secret) {
    throw new Error(`CLOB credentials missing secret. Response: ${JSON.stringify(creds)}`);
  }

  // Second pass: reconstruct with creds and sig type
  return new ClobClient(env.clobApiUrl, Chain.POLYGON, walletClient, creds, SIG_TYPE);
}

// Lazy singleton — first call triggers auth, all subsequent calls reuse it.
// Two simultaneous callers at startup will both await the same Promise.
let clientPromise: Promise<ClobClient> | null = null;

export function getClobClient(): Promise<ClobClient> {
  if (!clientPromise) {
    clientPromise = initClobClient();
  }
  return clientPromise;
}
