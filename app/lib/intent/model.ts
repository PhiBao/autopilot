import type { Address } from "viem";

export type IntentKind = "deposit" | "exit";

export type StepKind = "sign-userop" | "wait-until";

export type StepStatus =
  | "pending_sign" // user must sign an XRPL payment for this userOp
  | "signed" // user signed; executor must deliver
  | "waiting" // step scheduled at triggerAt
  | "executed"
  | "failed";

export type UserOpStep = {
  calls: { target: Address; value: bigint; data: `0x${string}` }[];
  memo: `0x${string}`; // 0xFE 42-byte memo data for the XRPL payment
  data: `0x${string}`; // ABI-encoded PackedUserOperation the executor delivers
  totalCallValue: bigint;
  nonce: bigint;
  paymentAmountXrp: number; // XRPL payment amount (net mint + fees)
  destination: string; // FXRP direct-minting address on XRPL
  executorFeeUBA: bigint;
};

export type Step = {
  id: string;
  kind: StepKind;
  status: StepStatus;
  order: number;
  label: string;
  detail: string;
  triggerAt?: number; // epoch ms when this step becomes actionable (wait-until)
  userOp?: UserOpStep;
  xrplTxHash?: string;
  flareTxHash?: string;
  result?: Record<string, unknown>;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

export type Intent = {
  id: string;
  xrplAddress: string;
  personalAccount: Address;
  kind: IntentKind;
  vaultId: bigint | null;
  vaultAddress: Address | null;
  amountUBA: bigint;
  status: "active" | "completed" | "failed";
  steps: Step[];
  createdAt: number;
  updatedAt: number;
};

export type IntentDraft = {
  xrplAddress: string;
  personalAccount: Address;
  kind: IntentKind;
  vaultId: bigint | null;
  vaultAddress: Address | null;
  amountUBA: bigint;
};

let counter = 0;
function uid(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function now(): number {
  return Date.now();
}

export function createStep(opts: {
  kind: StepKind;
  order: number;
  label: string;
  detail: string;
  status: StepStatus;
  triggerAt?: number;
  userOp?: UserOpStep;
}): Step {
  const ts = now();
  return {
    id: uid("step"),
    kind: opts.kind,
    status: opts.status,
    order: opts.order,
    label: opts.label,
    detail: opts.detail,
    ...(opts.triggerAt !== undefined ? { triggerAt: opts.triggerAt } : {}),
    ...(opts.userOp !== undefined ? { userOp: opts.userOp } : {}),
    createdAt: ts,
    updatedAt: ts,
  };
}

export function createIntent(draft: IntentDraft): Intent {
  const ts = now();
  return {
    id: uid("int"),
    xrplAddress: draft.xrplAddress,
    personalAccount: draft.personalAccount,
    kind: draft.kind,
    vaultId: draft.vaultId,
    vaultAddress: draft.vaultAddress,
    amountUBA: draft.amountUBA,
    status: "active",
    steps: [],
    createdAt: ts,
    updatedAt: ts,
  };
}

export function touch(intent: Intent): Intent {
  return { ...intent, updatedAt: now() };
}

/** Mark a step failed and cascade the intent to failed. */
export function failStep(intent: Intent, stepId: string, error: string): Intent {
  const steps = intent.steps.map((s) =>
    s.id === stepId ? { ...s, status: "failed" as const, error, updatedAt: now() } : s
  );
  return { ...intent, steps, status: "failed", updatedAt: now() };
}

/** After any step transition, derive the overall intent status. */
export function reconcileIntent(intent: Intent): Intent {
  const steps = intent.steps;
  if (steps.some((s) => s.status === "failed")) {
    return { ...intent, status: "failed", updatedAt: now() };
  }
  const allDone = steps.length > 0 && steps.every((s) => s.status === "executed");
  if (allDone) {
    return { ...intent, status: "completed", updatedAt: now() };
  }
  return intent;
}

/** Mark a step as needing the user's signature once its trigger time has passed. */
export function promoteReadySteps(intent: Intent, nowTs: number = now()): Intent {
  const steps = intent.steps.map((s) => {
    if (s.status === "waiting" && s.triggerAt !== undefined && nowTs >= s.triggerAt) {
      return { ...s, status: "pending_sign" as const, updatedAt: nowTs };
    }
    return s;
  });
  return { ...intent, steps, updatedAt: nowTs };
}

/**
 * Rehydrate an intent read from JSON storage back to its runtime shape.
 * BigInt fields are serialized as strings (see lib/server/json.ts); this restores
 * them so downstream signing/execution behaves identically to in-memory intents.
 */
export function hydrateIntent(raw: Record<string, unknown>): Intent {
  const intent = { ...(raw as unknown as Intent) };
  intent.vaultId = typeof intent.vaultId === "string" ? BigInt(intent.vaultId) : intent.vaultId;
  intent.amountUBA = typeof intent.amountUBA === "string" ? BigInt(intent.amountUBA) : intent.amountUBA;
  intent.steps = intent.steps.map((step) => {
    const s = { ...step };
    if (s.userOp) {
      const u = { ...s.userOp };
      u.totalCallValue = typeof u.totalCallValue === "string" ? BigInt(u.totalCallValue) : u.totalCallValue;
      u.nonce = typeof u.nonce === "string" ? BigInt(u.nonce) : u.nonce;
      u.executorFeeUBA =
        typeof u.executorFeeUBA === "string" ? BigInt(u.executorFeeUBA) : u.executorFeeUBA;
      s.userOp = u;
    }
    return s;
  });
  return intent;
}
