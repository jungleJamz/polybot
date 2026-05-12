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

  // First pass: no creds — used only to derive the API key
  const unauthClient = new ClobClient(
    env.clobApiUrl,
    Chain.POLYGON,
    walletClient,
    undefined,
    2 as any,
    env.proxyWallet,
  );

  // SDK has throwOnError=false by default — API errors return { key: undefined, ... }
  // instead of throwing. We must check creds are valid before using them.
  let creds: any;
  try {
    creds = await unauthClient.deriveApiKey();
  } catch {
    // deriveApiKey threw — try createOrDeriveApiKey as fallback
  }

  if (!creds?.secret) {
    // Either threw or returned an error response (first-time wallet needs create)
    try {
      creds = await unauthClient.createOrDeriveApiKey();
    } catch (err: any) {
      throw new Error(`Failed to obtain CLOB API credentials: ${err.message}`);
    }
  }

  if (!creds?.secret) {
    throw new Error(`CLOB credentials missing secret. Response: ${JSON.stringify(creds)}`);
  }

  // Second pass: reconstruct with creds so all subsequent calls are authenticated
  return new ClobClient(
    env.clobApiUrl,
    Chain.POLYGON,
    walletClient,
    creds,
    2 as any,
    env.proxyWallet,
  );
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
