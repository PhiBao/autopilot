import type { Chain } from "viem";

export const FLARE_CONTRACT_REGISTRY_ADDRESS =
  "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019" as const;

export const COSTON2 = {
  chainId: 114,
  rpcUrl: process.env.COSTON2_RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc",
  wsUrl: process.env.COSTON2_WS_URL ?? "wss://coston2-api.flare.network/ext/C/ws",
} as const;

export const FLARE_MAINNET = {
  chainId: 14,
  rpcUrl: process.env.FLARE_RPC_URL ?? "https://flare-api.flare.network/ext/C/rpc",
} as const;

export type NetworkId = "coston2" | "flare";

export function isCoston2(network: NetworkId): boolean {
  return network === "coston2";
}

export const NETWORKS: Record<NetworkId, { chainId: number; rpcUrl: string; wsUrl?: string }> = {
  coston2: COSTON2,
  flare: FLARE_MAINNET,
};

export const FDC_VERIFIER_URLS: Record<NetworkId, string> = {
  coston2: process.env.VERIFIER_URL_TESTNET ?? "https://fdc-verifiers-testnet.flare.network/",
  flare: process.env.VERIFIER_URL_MAINNET ?? "https://fdc-verifiers-mainnet.flare.network/",
};

export const DA_LAYER_URLS: Record<NetworkId, string> = {
  coston2: process.env.COSTON2_DA_LAYER_URL ?? "https://ctn2-data-availability.flare.network",
  flare: process.env.FLARE_DA_LAYER_URL ?? "https://flr-data-availability.flare.network",
};

export const FDC_API_KEY: Record<NetworkId, string> = {
  coston2: process.env.VERIFIER_API_KEY_TESTNET ?? "00000000-0000-0000-0000-000000000000",
  flare: process.env.VERIFIER_API_KEY_MAINNET ?? "00000000-0000-0000-0000-000000000000",
};

export const XRPL_RPC_URLS: Record<NetworkId, string> = {
  coston2: process.env.XRPL_TESTNET_RPC_URL ?? "wss://testnet.xrpl-labs.com",
  flare: process.env.XRPL_MAINNET_RPC_URL ?? "wss://s1.ripple.com",
};

export const FDC_XRP_SOURCE_IDS: Record<NetworkId, string> = {
  coston2: "testXRP",
  flare: "XRP",
};

export const CHAIN_FOR_NETWORK: Record<NetworkId, Chain | null> = {
  coston2: null,
  flare: null,
};

export const DEFAULT_NETWORK: NetworkId = (process.env.NEXT_PUBLIC_NETWORK as NetworkId) ?? "coston2";

export const MAX_DIRECT_MINT_RECEIPT_SEARCH_BLOCKS = 10_000n;
export const COSTON2_MAX_LOG_BLOCK_RANGE = 29n;

export const DIRECT_MINTING_PAYMENT_FEE_SLIPPAGE = 0.1;
