"use client";

export type Position = {
  vaultId: string;
  vaultAddress: string;
  name: string;
  operator: string;
  type: string;
  riskLevel: string;
  strategy: string;
  lockup: string;
  shares: string;
  assets: string;
  assetsXrp: string;
  apyBps: number | null;
};

export type IntentStepDto = {
  id: string;
  kind: string;
  status: string;
  order: number;
  label: string;
  detail: string;
  triggerAt?: number;
  xrplTxHash?: string;
  flareTxHash?: string;
  result?: Record<string, unknown>;
  error?: string;
  userOp?: {
    destination: string;
    paymentAmountXrp: number;
    memo: string;
    nonce: string;
    totalCallValue: string;
  };
};

export type IntentDto = {
  id: string;
  xrplAddress: string;
  personalAccount: string;
  kind: string;
  vaultId: string | null;
  vaultAddress: string | null;
  amountUBA: string;
  status: string;
  steps: IntentStepDto[];
  createdAt: number;
  updatedAt: number;
};

export type VaultDto = {
  id: string;
  address: string;
  type: string;
  name: string;
  operator: string;
  strategy: string;
  lockup: string;
  riskLevel: string;
  riskNotes: string[];
  apyBps: number | null;
  capXrp: string | null;
  deployed: boolean;
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export function formatXrp(u: bigint | string): string {
  const n = typeof u === "string" ? BigInt(u) : u;
  const whole = n / 1_000_000n;
  const frac = (n % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `${whole}.${frac}`;
}

export function shortAddress(addr: string, len = 6): string {
  if (!addr) return "";
  return addr.length <= len * 2 + 3 ? addr : `${addr.slice(0, len)}…${addr.slice(-4)}`;
}

export const CONNECT_KEY = "autopilot_xrpl";
export const DEMO_XRPL = process.env.NEXT_PUBLIC_DEMO_XRPL ?? "";
