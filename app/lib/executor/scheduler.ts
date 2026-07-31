import { Client, Wallet } from "xrpl";
import type { FlareContext } from "../flare/context";
import type { Intent } from "../intent/model";
import { promoteReadySteps, failStep, reconcileIntent, now, type Step } from "../intent/model";
import { deliverUserOp, assertUserOpExecuted } from "./deliver";
import { finalizeExitAfterRedeem } from "../intent/engine";
import { getVaultProfile } from "../flare/vaults";
import { getAssetManagerFXRPAddress } from "../flare/contract-registry";
import { parseEventLogs } from "viem";
import { iDirectMintingAbi } from "@flarenetwork/flare-wagmi-periphery-package/contracts/coston2";

async function readPeriodSettings(ctx: FlareContext, vaultAddress: `0x${string}`) {
  const abi = [
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
      type: "function",
      name: "lagDuration",
      stateMutability: "view",
      inputs: [],
      outputs: [{ name: "", type: "uint256" }],
    },
  ] as const;
  try {
    const [periodDuration, lag, lagDuration] = await Promise.all([
      ctx.publicClient.readContract({ address: vaultAddress, abi, functionName: "periodDuration" }).catch(() => 86_400n),
      ctx.publicClient.readContract({ address: vaultAddress, abi, functionName: "lag" }).catch(() => undefined),
      ctx.publicClient.readContract({ address: vaultAddress, abi, functionName: "lagDuration" }).catch(() => undefined),
    ]);
    // Registered Firelight/Upshift test vaults expose `lagDuration` instead of `lag`.
    const effectiveLag = lag !== undefined ? lag : lagDuration ?? 86_400n;
    return { periodDuration: BigInt(periodDuration), lag: BigInt(effectiveLag) };
  } catch {
    return { periodDuration: 86_400n, lag: 86_400n };
  }
}

export type TickReport = {
  promoted: number;
  delivered: number;
  failed: number;
  details: string[];
};

// In-process guard so concurrent ticks (cron + dashboard pollers) never deliver
// the same step twice.
const inFlightSteps = new Set<string>();

/**
 * Advance all active intents one step:
 *  - promote `waiting` steps to `pending_sign` once their trigger time passes
 *  - deliver any `signed` step's userOp through the executor
 *  - finalize exit intents after the redeem executes (compute claim period)
 */
export async function tickExecutor(
  ctx: FlareContext,
  {
    loadActive,
    save,
  }: {
    loadActive: () => Promise<Intent[]>;
    save: (i: Intent) => Promise<void>;
  },
  xrplAddressOverride?: string
): Promise<TickReport> {
  const report: TickReport = { promoted: 0, delivered: 0, failed: 0, details: [] };
  const intents = await loadActive();

  for (const raw of intents) {
    if (xrplAddressOverride && raw.xrplAddress.toLowerCase() !== xrplAddressOverride.toLowerCase()) {
      continue;
    }
    let intent: Intent = raw;

    // 1. Promote ready steps (waiting → pending_sign once triggerAt passes).
    const beforePending = intent.steps.filter((s) => s.status === "pending_sign").length;
    intent = promoteReadySteps(intent);
    const afterPending = intent.steps.filter((s) => s.status === "pending_sign").length;
    report.promoted += Math.max(0, afterPending - beforePending);

    // 2. Deliver signed steps in order.
    for (const step of intent.steps) {
      if (step.status !== "signed") continue;
      if (inFlightSteps.has(step.id)) break; // another tick is delivering this step
      inFlightSteps.add(step.id);
      let outcome: { ok: boolean; intent: Intent };
      try {
        outcome = await deliverSignedStep(ctx, intent, step, save);
      } finally {
        inFlightSteps.delete(step.id);
      }
      intent = outcome.intent; // preserve failure/success state saved inside
      if (outcome.ok) {
        report.delivered += 1;
      } else {
        report.failed += 1;
        const errStep = outcome.intent.steps.find((s) => s.id === step.id);
        if (errStep?.error) report.details.push(`${intent.kind}:${step.label}: ${errStep.error}`);
      }
      break; // one step per tick to avoid nonce races
    }

    intent = reconcileIntent(intent);
    await save(intent);
  }

  return report;
}

async function deliverSignedStep(
  ctx: FlareContext,
  intent: Intent,
  step: Step,
  save: (i: Intent) => Promise<void>
): Promise<{ ok: boolean; intent: Intent }> {
  const userOp = step.userOp;
  if (!userOp || !step.xrplTxHash) {
    const failed = failStep(intent, step.id, "signed step missing userOp or xrplTxHash");
    await save(failed);
    return { ok: false, intent: failed };
  }
  const xrplClient = new Client(ctx.xrplRpcUrl);
  try {
    const result = await deliverUserOp(ctx, {
      xrplTransactionHash: step.xrplTxHash,
      data: userOp.data,
      totalCallValue: userOp.totalCallValue,
      personalAccount: intent.personalAccount,
      xrplClient,
      expectNonce: userOp.nonce,
    });
    assertUserOpExecuted(result, intent.personalAccount);

    const updated: Step = {
      ...step,
      status: "executed",
      flareTxHash: result.flareTxHash,
      result: { userOpNonce: result.userOpNonce.toString(), delayed: result.delayed },
      updatedAt: now(),
    };

    // Exit intents: after the redeem executes, compute the claim period + trigger.
    if (intent.kind === "exit" && step.order === 0 && intent.vaultAddress) {
      const vault = getVaultProfile(intent.vaultAddress);
      if (vault) {
        const { periodDuration, lag } = await readPeriodSettings(ctx, intent.vaultAddress);
        const finalized = await finalizeExitAfterRedeem(
          ctx,
          { ...intent, steps: [updated, intent.steps[1]!] },
          result.receipt,
          vault,
          periodDuration,
          lag
        );
        await save(finalized);
        return { ok: true, intent: finalized };
      }
    }

    const steps = intent.steps.map((s) => (s.id === step.id ? updated : s));
    const saved = { ...intent, steps, updatedAt: now() };
    await save(saved);
    return { ok: true, intent: saved };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 1500);
    const failed = failStep(intent, step.id, msg);
    await save(failed);
    return { ok: false, intent: failed };
  } finally {
    try {
      await xrplClient.disconnect();
    } catch {
      /* noop */
    }
  }
}

/** Read the DirectMintingExecutedToSmartAccount log amount from a delivery receipt (diagnostics). */
export function mintedAmountFromReceipt(receipt: { logs: readonly unknown[] }) {
  try {
    const logs = parseEventLogs({
      abi: iDirectMintingAbi,
      eventName: "DirectMintingExecutedToSmartAccount",
      logs: receipt.logs as never,
    });
    return logs.length > 0
      ? (logs[0]!.args as { mintedAmountUBA: bigint }).mintedAmountUBA
      : undefined;
  } catch {
    return undefined;
  }
}

export type { Wallet };
