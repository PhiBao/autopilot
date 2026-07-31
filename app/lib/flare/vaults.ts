import type { Address } from "viem";

export const FXRP_DECIMALS = 6;
export const XRP_TO_UBA = BigInt(1_000_000);

export type VaultType = "firelight" | "upshift" | "autopilot";

export type RiskLevel = "low" | "medium" | "high";

export type VaultProfile = {
  id: bigint;
  address: Address;
  type: VaultType;
  name: string;
  operator: string;
  strategy: string;
  lockup: string;
  riskLevel: RiskLevel;
  riskNotes: string[];
  /** Stored as basis points per year; null if unknown. */
  apyBps: number | null;
  capUBA: bigint | null;
  deployed?: boolean; // true for our own demo vault
};

// Vault ABIs shared by Firelight-style single-asset vaults and our AutopilotVault.
export const firelightVaultAbi = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_assets", type: "uint256" },
      { name: "_receiver", type: "address" },
    ],
    outputs: [{ name: "_shares", type: "uint256" }],
  },
  {
    type: "function",
    name: "redeem",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_shares", type: "uint256" },
      { name: "_receiver", type: "address" },
      { name: "_owner", type: "address" },
    ],
    outputs: [{ name: "_assets", type: "uint256" }],
  },
  {
    type: "function",
    name: "claimWithdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "_period", type: "uint256" }],
    outputs: [{ name: "_assets", type: "uint256" }],
  },
  {
    type: "function",
    name: "currentPeriod",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "convertToAssets",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "previewRedeem",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalAssets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "periodDuration",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "lag",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "WithdrawRequest",
    inputs: [
      { name: "caller", type: "address", indexed: true },
      { name: "receiver", type: "address", indexed: true },
      { name: "period", type: "uint256", indexed: false },
      { name: "assets", type: "uint256", indexed: false },
      { name: "shares", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "WithdrawalClaimed",
    inputs: [
      { name: "receiver", type: "address", indexed: true },
      { name: "period", type: "uint256", indexed: false },
      { name: "assets", type: "uint256", indexed: false },
    ],
  },
] as const;

// Upshift-style vault (multi-asset deposit signature).
export const upshiftVaultAbi = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_assetIn", type: "address" },
      { name: "_amountIn", type: "uint256" },
      { name: "_receiverAddr", type: "address" },
    ],
    outputs: [{ name: "_shares", type: "uint256" }],
  },
  {
    type: "function",
    name: "requestRedeem",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_shares", type: "uint256" },
      { name: "_receiverAddr", type: "address" },
    ],
    outputs: [
      { name: "_claimableEpoch", type: "uint256" },
      { name: "_year", type: "uint256" },
      { name: "_month", type: "uint256" },
      { name: "_day", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_year", type: "uint256" },
      { name: "_month", type: "uint256" },
      { name: "_day", type: "uint256" },
      { name: "_receiverAddr", type: "address" },
    ],
    outputs: [
      { name: "_shares", type: "uint256" },
      { name: "_assetsAfterFee", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "previewRedemption",
    stateMutability: "view",
    inputs: [
      { name: "_shares", type: "uint256" },
      { name: "_isInstant", type: "bool" },
    ],
    outputs: [
      { name: "_assetsAmount", type: "uint256" },
      { name: "_assetsAfterFee", type: "uint256" },
    ],
  },
] as const;

// Deployed AutopilotVault on Coston2 (our demo vault: fast 60s periods).
export const AUTOPILOT_VAULT_ADDRESS = "0x040fee7daab727d6afb8efe6b770b15c0b2a89f6" as const;

export const COSTON2_VAULTS: VaultProfile[] = [
  {
    id: 1n,
    address: "0xC90D6847747b85d1fa2E07859869fb9fB72c0361",
    type: "firelight",
    name: "Firelight XRP Staking",
    operator: "Firelight (Sentora)",
    strategy: "Staked XRP backs on-chain DeFi cover policies; rewards paid in XRP.",
    lockup: "~1 day redemption period",
    riskLevel: "medium",
    riskNotes: [
      "Cover-policy backing: returns depend on cover buyers paying premiums",
      "Redemption gated by daily periods; withdrawals complete next period",
      "Rewards are managed yields, not fixed rates",
    ],
    apyBps: null,
    capUBA: BigInt(65_000_000) * XRP_TO_UBA,
  },
  {
    id: 2n,
    address: "0x9E63a5D282F2fBb7DcE822B98e363b2719D28319",
    type: "upshift",
    name: "Clearstar XRP Yield",
    operator: "Clearstar (via Upshift)",
    strategy: "Fully on-chain: deploys FXRP across lending and supply protocols on Flare.",
    lockup: "Daily claim epochs",
    riskLevel: "medium",
    riskNotes: [
      "All positions verifiable on-chain in real time",
      "Returns move week to week based on lending rates",
      "Claim available after next day epoch",
    ],
    apyBps: null,
    capUBA: null,
  },
  {
    id: 3n,
    address: "0x4066A1363a04ce3B23eEcB53dEfa65f94A24355E",
    type: "upshift",
    name: "Monarq MXRPY (test)",
    operator: "Monarq (FalconX)",
    strategy: "Multi-strategy XRP yield vault (test instance).",
    lockup: "Daily claim epochs",
    riskLevel: "high",
    riskNotes: ["Blends on-chain and off-chain strategies", "Managed, not fixed-rate"],
    apyBps: null,
    capUBA: null,
  },
  {
    id: 4n,
    address: "0xD91324A6e8884147F6425E9ddd60e11Aea060B5b",
    type: "upshift",
    name: "Upshift Test Vault",
    operator: "Upshift",
    strategy: "On-chain capital allocation (test instance).",
    lockup: "Daily claim epochs",
    riskLevel: "medium",
    riskNotes: ["Test vault", "Deploys across Flare lending"],
    apyBps: null,
    capUBA: null,
  },
  {
    id: 900n,
    address: AUTOPILOT_VAULT_ADDRESS,
    type: "autopilot",
    name: "Autopilot Demo Vault",
    operator: "Autopilot (demo)",
    strategy: "Simple XRP savings vault with fast 60s redemption periods for demonstration.",
    lockup: "~60s redemption periods",
    riskLevel: "low",
    riskNotes: ["Demo vault deployed by Autopilot for lifecycle testing", "1:1 share pricing on FXRP", "Short periods for fast validation"],
    apyBps: null,
    capUBA: null,
    deployed: true,
  },
];

export function getVaultProfile(address: Address): VaultProfile | undefined {
  const a = address.toLowerCase();
  return COSTON2_VAULTS.find((v) => v.address.toLowerCase() === a);
}

export function vaultAbiFor(profile: VaultProfile) {
  return profile.type === "upshift" ? upshiftVaultAbi : firelightVaultAbi;
}

export function formatXrp(u: bigint): string {
  const whole = u / XRP_TO_UBA;
  const frac = (u % XRP_TO_UBA).toString().padStart(6, "0").slice(0, 2);
  return `${whole}.${frac}`;
}
