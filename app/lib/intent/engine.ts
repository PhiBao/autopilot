import { encodeFunctionData, erc20Abi, parseEventLogs, type Address, type TransactionReceipt } from "viem";
import type { PublicFlareContext } from "../flare/context";
import { getFxrpAddress } from "../flare/contract-registry";
import type { VaultProfile } from "../flare/vaults";
import { firelightVaultAbi, upshiftVaultAbi, vaultAbiFor, formatXrp, XRP_TO_UBA } from "../flare/vaults";
import { prepareUserOp } from "./userop";
import {
  createIntent,
  createStep,
  touch,
  type Intent,
  type Step,
  type IntentDraft,
} from "./model";

const FXRP_NET_MINT_BY_AMOUNT = (u: bigint) => Number(u) / Number(XRP_TO_UBA);

/** Build the "deposit" intent: one signature mints FXRP and deposits into the vault atomically. */
export async function buildDepositIntent(
  ctx: PublicFlareContext,
  draft: { xrplAddress: string; personalAccount: Address; vault: VaultProfile; amountUBA: bigint }
): Promise<Intent> {
  const { vault, personalAccount, amountUBA } = draft;
  const fxrpAddress = await getFxrpAddress(ctx);

  const calls = [
    {
      target: fxrpAddress,
      value: 0n,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [vault.address, amountUBA] }),
    },
    {
      target: vault.address,
      value: 0n,
      data: encodeFunctionData({
        abi: vaultAbiFor(vault),
        functionName: "deposit",
        args: vault.type === "upshift" ? [fxrpAddress, amountUBA, personalAccount] : [amountUBA, personalAccount],
      }),
    },
  ];

  const userOp = await prepareUserOp(ctx, {
    calls,
    personalAccount,
    netMintAmountXrp: FXRP_NET_MINT_BY_AMOUNT(amountUBA),
  });

  const intent = createIntent({
    xrplAddress: draft.xrplAddress,
    personalAccount,
    kind: "deposit",
    vaultId: vault.id,
    vaultAddress: vault.address,
    amountUBA,
  });

  intent.steps.push(
    createStep({
      kind: "sign-userop",
      order: 0,
      label: "Mint & deposit",
      detail: `Deposit ${formatXrp(amountUBA)} FXRP into ${vault.name}`,
      status: "pending_sign",
      userOp,
    })
  );

  return touch(intent);
}

/**
 * Build the "exit" intent for a Firelight-style vault: redeem now, then a
 * claim step that the executor finalizes with the exact redemption period
 * once the redeem executes (the claim's trigger is the next period roll).
 */
export async function buildExitIntent(
  ctx: PublicFlareContext,
  draft: { xrplAddress: string; personalAccount: Address; vault: VaultProfile; shares: bigint }
): Promise<Intent> {
  const { vault, personalAccount, shares } = draft;
  const calls = [
    {
      target: vault.address,
      value: 0n,
      data: encodeFunctionData({
        abi: vaultAbiFor(vault),
        functionName: "redeem",
        args: [shares, personalAccount, personalAccount],
      }),
    },
  ];

  const userOp = await prepareUserOp(ctx, {
    calls,
    personalAccount,
    netMintAmountXrp: 0,
  });

  const intent = createIntent({
    xrplAddress: draft.xrplAddress,
    personalAccount,
    kind: "exit",
    vaultId: vault.id,
    vaultAddress: vault.address,
    amountUBA: shares,
  });

  intent.steps.push(
    createStep({
      kind: "sign-userop",
      order: 0,
      label: "Request withdrawal",
      detail: `Burn ${formatXrp(shares)} vault shares to start the exit`,
      status: "pending_sign",
      userOp,
    }),
    createStep({
      kind: "sign-userop",
      order: 1,
      label: "Claim after period",
      detail: "Awaiting redemption period — Autopilot will prepare this when it's time",
      status: "waiting",
    })
  );

  return touch(intent);
}

export type RedeemOutcome = {
  period: bigint;
  assets: bigint;
  shares: bigint;
  rollAt: number; // epoch ms when the period rolls (claimable)
};

/**
 * Parse the WithdrawRequest event from the redeem receipt to derive the
 * redemption period and when it becomes claimable. This is the piece users
 * currently have to track manually.
 */
export function parseRedeemOutcome(
  receipt: TransactionReceipt,
  vault: VaultProfile,
  personalAccount: Address,
  periodDurationSeconds: bigint,
  lagSeconds: bigint
): RedeemOutcome {
  const abi = vault.type === "upshift" ? upshiftVaultAbi : firelightVaultAbi;
  const logs = parseEventLogs({ abi, eventName: "WithdrawRequest", logs: receipt.logs });
  const wd = logs.find(
    (l) => (l.args as { receiver: Address }).receiver.toLowerCase() === personalAccount.toLowerCase()
  );
  if (!wd) {
    throw new Error("WithdrawRequest event not found in redeem receipt");
  }
  const args = wd.args as { period: bigint; assets: bigint; shares: bigint };
  const period = args.period;
  // The claim becomes valid once the period has rolled (period < currentPeriod)
  // AND the lag has elapsed since the request.
  const periodEnd = (period + 1n) * periodDurationSeconds;
  const requestAt = Number(receipt.blockTimestamp ?? BigInt(Math.floor(Date.now() / 1000)));
  const lagEnd = requestAt + Number(lagSeconds);
  const rollAt = Math.max(Number(periodEnd), lagEnd) * 1000;
  return { period, assets: args.assets, shares: args.shares, rollAt };
}

/** Finalize the exit intent after the redeem userOp executed: set the claim's trigger + userOp. */
export async function finalizeExitAfterRedeem(
  ctx: PublicFlareContext,
  intent: Intent,
  receipt: TransactionReceipt,
  vault: VaultProfile,
  periodDurationSeconds: bigint,
  lagSeconds: bigint
): Promise<Intent> {
  const claimStep = intent.steps[1];
  if (!claimStep || claimStep.kind !== "sign-userop") {
    throw new Error("Exit intent missing claim step");
  }
  const outcome = parseRedeemOutcome(receipt, vault, intent.personalAccount, periodDurationSeconds, lagSeconds);

  const calls = [
    {
      target: vault.address,
      value: 0n,
      data: encodeFunctionData({
        abi: vaultAbiFor(vault),
        functionName: "claimWithdraw",
        args: [outcome.period],
      }),
    },
  ];
  const userOp = await prepareUserOp(ctx, {
    calls,
    personalAccount: intent.personalAccount,
    netMintAmountXrp: 0,
  });

  const steps = intent.steps.map((s, i) => {
    if (i === 1) {
      return {
        ...s,
        status: "waiting" as const,
        triggerAt: outcome.rollAt,
        userOp,
        detail: `FXRP claimable after period ${outcome.period.toString()} rolls — sign when Autopilot notifies you`,
        updatedAt: Date.now(),
      };
    }
    return s;
  });

  return { ...intent, steps, updatedAt: Date.now() };
}

export type { Step };
