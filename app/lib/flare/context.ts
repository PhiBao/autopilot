import { createPublicClient, createWalletClient, defineChain, http, type Chain } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { Client as XrplClient } from "xrpl";
import { XRPL_RPC_URLS } from "./config";
import { NonceTracker } from "./nonce-tracker";

// Module-level shared nonce trackers so rapid sequential writes across API
// requests/ticks never reuse a nonce (Avalanche C-chain pending reads lag).
const sharedNonceTrackers = new Map<string, NonceTracker>();
export function getSharedNonceTracker(publicClient: ReturnType<typeof createPublicClient>, address: string) {
  let tracker = sharedNonceTrackers.get(address);
  if (!tracker) {
    tracker = new NonceTracker(publicClient, address as `0x${string}`);
    sharedNonceTrackers.set(address, tracker);
  }
  return tracker;
}

export const coston2Chain = defineChain({
  id: 114,
  name: "Flare Testnet Coston2",
  nativeCurrency: { name: "Coston2 Flare", symbol: "C2FLR", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["https://coston2-api.flare.network/ext/C/rpc"],
    },
  },
  blockExplorers: {
    default: {
      name: "Coston2 Explorer",
      url: "https://coston2-explorer.flare.network",
    },
  },
});

export const flareChain = defineChain({
  id: 14,
  name: "Flare",
  nativeCurrency: { name: "Flare", symbol: "FLR", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["https://flare-api.flare.network/ext/C/rpc"],
    },
  },
  blockExplorers: {
    default: {
      name: "Flare Explorer",
      url: "https://flare-explorer.flare.network",
    },
  },
});

export const CHAINS = { coston2: coston2Chain, flare: flareChain } as const;

export type FlareContext = {
  network: "coston2" | "flare";
  chain: Chain;
  rpcUrl: string;
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient: ReturnType<typeof createWalletClient>;
  executorAccount: PrivateKeyAccount;
  nonceTracker: NonceTracker;
  fdcVerifierUrl: string;
  fdcApiKey: string;
  daLayerUrl: string;
  xrplRpcUrl: string;
  fdcXrpSourceId: string;
};

export type PublicFlareContext = Omit<FlareContext, "walletClient" | "executorAccount" | "nonceTracker">;

function getTransport(network: "coston2" | "flare", rpcUrl: string) {
  return http(rpcUrl, {
    ...(network === "coston2"
      ? { batch: { batchSize: 100, wait: 250 } }
      : {}),
  });
}

export function createFlareContext(
  network: "coston2" | "flare" = "coston2",
  opts?: { executorPrivateKey?: `0x${string}` }
): FlareContext {
  const chain = CHAINS[network];
  const rpcUrl =
    network === "coston2"
      ? process.env.COSTON2_RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc"
      : process.env.FLARE_RPC_URL ?? "https://flare-api.flare.network/ext/C/rpc";

  const publicClient = createPublicClient({
    chain,
    transport: getTransport(network, rpcUrl),
  });

  const walletClient = createWalletClient({
    chain,
    transport: getTransport(network, rpcUrl),
  });

  const pk = opts?.executorPrivateKey ?? (process.env.EXECUTOR_PRIVATE_KEY as `0x${string}` | undefined);
  if (!pk) {
    throw new Error("EXECUTOR_PRIVATE_KEY is required to create a FlareContext with an executor");
  }
  const executorAccount = privateKeyToAccount(pk);
  const nonceTracker = getSharedNonceTracker(publicClient, executorAccount.address);

  return {
    network,
    chain,
    rpcUrl,
    publicClient,
    walletClient,
    executorAccount,
    nonceTracker,
    fdcVerifierUrl:
      network === "coston2"
        ? process.env.VERIFIER_URL_TESTNET ?? "https://fdc-verifiers-testnet.flare.network/"
        : process.env.VERIFIER_URL_MAINNET ?? "https://fdc-verifiers-mainnet.flare.network/",
    fdcApiKey:
      network === "coston2"
        ? process.env.VERIFIER_API_KEY_TESTNET ?? "00000000-0000-0000-0000-000000000000"
        : process.env.VERIFIER_API_KEY_MAINNET ?? "00000000-0000-0000-0000-000000000000",
    daLayerUrl:
      network === "coston2"
        ? process.env.COSTON2_DA_LAYER_URL ?? "https://ctn2-data-availability.flare.network"
        : process.env.FLARE_DA_LAYER_URL ?? "https://flr-data-availability.flare.network",
    xrplRpcUrl: XRPL_RPC_URLS[network],
    fdcXrpSourceId: network === "coston2" ? "testXRP" : "XRP",
  };
}

export function createPublicFlareContext(network: "coston2" | "flare" = "coston2"): PublicFlareContext {
  const chain = CHAINS[network];
  const rpcUrl =
    network === "coston2"
      ? process.env.COSTON2_RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc"
      : process.env.FLARE_RPC_URL ?? "https://flare-api.flare.network/ext/C/rpc";

  const publicClient = createPublicClient({
    chain,
    transport: getTransport(network, rpcUrl),
  });

  return {
    network,
    chain,
    rpcUrl,
    publicClient,
    fdcVerifierUrl:
      network === "coston2"
        ? process.env.VERIFIER_URL_TESTNET ?? "https://fdc-verifiers-testnet.flare.network/"
        : process.env.VERIFIER_URL_MAINNET ?? "https://fdc-verifiers-mainnet.flare.network/",
    fdcApiKey:
      network === "coston2"
        ? process.env.VERIFIER_API_KEY_TESTNET ?? "00000000-0000-0000-0000-000000000000"
        : process.env.VERIFIER_API_KEY_MAINNET ?? "00000000-0000-0000-0000-000000000000",
    daLayerUrl:
      network === "coston2"
        ? process.env.COSTON2_DA_LAYER_URL ?? "https://ctn2-data-availability.flare.network"
        : process.env.FLARE_DA_LAYER_URL ?? "https://flr-data-availability.flare.network",
    xrplRpcUrl: XRPL_RPC_URLS[network],
    fdcXrpSourceId: network === "coston2" ? "testXRP" : "XRP",
  };
}

export function createXrplClient(network: "coston2" | "flare" = "coston2"): XrplClient {
  return new XrplClient(XRPL_RPC_URLS[network]);
}

export type { XrplClient };
