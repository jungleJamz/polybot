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

  // deriveApiKey is deterministic — given the same private key it always
  // returns the same key, so we prefer it over createApiKey which errors
  // with a noisy 400 if the key already exists.
  let creds: any;
  try {
    creds = await unauthClient.deriveApiKey();
  } catch {
    creds = await unauthClient.createOrDeriveApiKey();
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
