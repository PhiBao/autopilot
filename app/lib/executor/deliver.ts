import { parseEventLogs, encodeFunctionData, type Address, type TransactionReceipt } from "viem";
import type { Client } from "xrpl";
import { iDirectMintingAbi } from "@flarenetwork/flare-wagmi-periphery-package/contracts/coston2";
import type { FlareContext } from "../flare/context";
import { getAssetManagerFXRPAddress } from "../flare/contract-registry";
import {
  getPersonalAccountAddress,
  getExecutor,
  isStuckTransactionIdUsed,
  isPaymentAlreadyConfirmedError,
  normalizeXrplTransactionId,
  findDirectMintingReceiptForTransactionId,
  findUserOperationExecuted,
  type Call,
} from "../flare/smart-accounts";
import { getNonce } from "../flare/nonce";
import { fetchXrpPaymentProof } from "../flare/smart-accounts";
import type { IXrpPaymentProof } from "../flare/fdc";
import { broadcastRaw } from "../flare/write";

const DELAYED_RETRY_BUFFER_MS = 5_000;
const MAX_DELAY_WAIT_MS = 30 * 60_000;

export type UserOpIntent = {
  personalAccount: Address;
  calls: Call[];
  memo: `0x${string}`;
  data: `0x${string}`;
  totalCallValue: bigint;
  nonce: bigint;
};

export type DeliverResult = {
  xrplTransactionHash: string;
  flareTxHash: `0x${string}`;
  receipt: TransactionReceipt;
  userOpNonce: bigint;
  delayed: boolean;
  recoveredExistingMint: boolean;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Extract the DirectMintingDelayed executionAllowedAt from a reverted receipt, if present. */
function getDelayTimestamp(receipt: TransactionReceipt): bigint | undefined {
  try {
    const logs = parseEventLogs({
      abi: iDirectMintingAbi,
      eventName: "DirectMintingDelayed",
      logs: receipt.logs,
    });
    if (logs.length > 0) {
      return logs[0]!.args.executionAllowedAt;
    }
  } catch {
    /* reverted receipts can contain partially-emitted logs */
  }
  return undefined;
}

/**
 * Deliver a 0xFE custom instruction on-chain.
 *
 * Drives the full executor-side flow for one XRPL payment that carries a
 * userOp hash memo:
 *
 *   1. Wait for XRPL finality (3 confirmations).
 *   2. Prepare + submit the FDC XRPPayment attestation request and fetch the proof.
 *   3. Call AssetManagerFXRP.executeDirectMintingWithData(proof, userOp).
 *   4. On `DirectMintingDelayed` (rate limiting), wait until `executionAllowedAt`
 *      and retry with the SAME proof (never a second XRPL payment with the same nonce).
 *   5. On `PaymentAlreadyConfirmed` (relayer already minted), load the existing
 *      Flare receipt instead of failing.
 *
 * Returns the receipt and whether the mint/userOp ran synchronously.
 */
export async function deliverUserOp(
  ctx: FlareContext,
  {
    xrplTransactionHash,
    data,
    totalCallValue,
    personalAccount,
    xrplClient,
    expectNonce,
  }: {
    xrplTransactionHash: string;
    data: `0x${string}`;
    totalCallValue: bigint;
    personalAccount: Address;
    xrplClient: Client;
    expectNonce: bigint;
  }
): Promise<DeliverResult> {
  const transactionId = normalizeXrplTransactionId(xrplTransactionHash);
  const assetManagerFxrpAddress = await getAssetManagerFXRPAddress(ctx);

  // Fetch the FDC proof ONCE; all retries reuse it.
  const proof = await fetchXrpPaymentProof(ctx, { xrplTransactionHash, xrplClient });

  const submit = async (): Promise<{ hash: `0x${string}`; receipt: TransactionReceipt }> => {
    const callData = encodeFunctionData({
      abi: iDirectMintingAbi,
      functionName: "executeDirectMintingWithData",
      args: [proof, data],
    });
    const hash = await broadcastRaw(ctx, { to: assetManagerFxrpAddress, data: callData, value: totalCallValue });
    const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
    return { hash, receipt };
  };

  // First attempt.
  let result: { hash: `0x${string}`; receipt: TransactionReceipt };
  try {
    result = await submit();
  } catch (error) {
    if (isPaymentAlreadyConfirmedError(error)) {
      const existing = await findDirectMintingReceiptForTransactionId(ctx, transactionId);
      return {
        xrplTransactionHash,
        flareTxHash: existing.transactionHash,
        receipt: existing,
        userOpNonce: expectNonce,
        delayed: false,
        recoveredExistingMint: true,
      };
    }
    throw error;
  }

  // Retry loop for DirectMintingDelayed.
  const startedAt = Date.now();
  while (result.receipt.status === "reverted") {
    const allowedAt = getDelayTimestamp(result.receipt);
    if (allowedAt === undefined) {
      throw new Error(
        `executeDirectMintingWithData reverted (tx ${result.hash}) with no DirectMintingDelayed event. ` +
          `Check the userOp bytes for nonce/hash/sender mismatches.`
      );
    }
    const waitMs = Number(allowedAt) * 1000 - Date.now() + DELAYED_RETRY_BUFFER_MS;
    const boundedWait = Math.max(0, Math.min(waitMs, MAX_DELAY_WAIT_MS - (Date.now() - startedAt)));
    console.log(
      `[executor] DirectMintingDelayed: retrying in ${Math.round(boundedWait / 1000)}s ` +
        `(executionAllowedAt=${allowedAt})`
    );
    await sleep(boundedWait);
    try {
      result = await submit();
    } catch (error) {
      if (isPaymentAlreadyConfirmedError(error)) {
        const existing = await findDirectMintingReceiptForTransactionId(ctx, transactionId);
        return {
          xrplTransactionHash,
          flareTxHash: existing.transactionHash,
          receipt: existing,
          userOpNonce: expectNonce,
          delayed: true,
          recoveredExistingMint: true,
        };
      }
      throw error;
    }
  }

  return {
    xrplTransactionHash,
    flareTxHash: result.hash,
    receipt: result.receipt,
    userOpNonce: expectNonce,
    delayed: false,
    recoveredExistingMint: false,
  };
}

/** Confirm the userOp ran, throwing a descriptive error if the mint was recovered without running it. */
export function assertUserOpExecuted(
  result: DeliverResult,
  personalAccount: Address
): { personalAccount: Address; nonce: bigint } {
  try {
    return findUserOperationExecuted(result.receipt, personalAccount, result.userOpNonce);
  } catch (e) {
    if (result.recoveredExistingMint) {
      throw new Error(
        "The XRPL payment was already finalized on Flare but the userOp did not run. " +
          "Recover via 0xE0 skip-memo, or check the original delivery receipt."
      );
    }
    throw e;
  }
}

/** Diagnose a stuck direct mint (transaction used? nonce? pinned executor?) for the 0xE0 recovery path. */
export async function diagnoseForRecovery(
  ctx: FlareContext,
  stuckXrplTxHash: string,
  xrplAddress: string
): Promise<{ transactionIdUsed: boolean; nonce: bigint; pinnedExecutor: Address }> {
  const personalAccount = await getPersonalAccountAddress(ctx, xrplAddress);
  const transactionId = normalizeXrplTransactionId(stuckXrplTxHash);
  const [transactionIdUsed, nonce, pinnedExecutor] = await Promise.all([
    isStuckTransactionIdUsed(ctx, transactionId),
    getNonce(ctx, personalAccount),
    getExecutor(ctx, personalAccount),
  ]);
  return { transactionIdUsed, nonce, pinnedExecutor };
}
