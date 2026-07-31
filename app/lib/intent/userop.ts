import type { Address } from "viem";
import type { PublicFlareContext } from "../flare/context";
import { getDirectMintingPaymentAddress } from "../flare/contract-registry";
import { getNonce } from "../flare/nonce";
import { encodeHashInstructionMemo, type Call } from "../flare/smart-accounts";
import { computeDirectMintingPaymentAmountXrp } from "../flare/fassets";
import type { UserOpStep } from "./model";

export type PreparedUserOp = Omit<UserOpStep, "destination" | "memo" | "data"> & {
  destination: string;
  memo: `0x${string}`;
  data: `0x${string}`;
};

/**
 * Prepare the user-side artifacts of a 0xFE custom instruction:
 * the XRPL destination, the 42-byte memo (keccak of the userOp), the full
 * userOp bytes (handed to the executor off-chain), and the exact XRPL payment
 * amount. The user signs the XRPL Payment; the executor delivers the bytes.
 */
export async function prepareUserOp(
  ctx: PublicFlareContext,
  {
    calls,
    personalAccount,
    netMintAmountXrp,
    executorFeeUBA = 0n,
    walletId = 0,
  }: {
    calls: Call[];
    personalAccount: Address;
    netMintAmountXrp: number;
    executorFeeUBA?: bigint;
    walletId?: number;
  }
): Promise<PreparedUserOp> {
  const [nonce, destination] = await Promise.all([
    getNonce(ctx, personalAccount),
    getDirectMintingPaymentAddress(ctx),
  ]);
  const { memoData, data } = encodeHashInstructionMemo({
    customInstruction: calls,
    walletId,
    executorFeeUBA,
    sender: personalAccount,
    nonce,
  });
  const totalCallValue = calls.reduce((acc, c) => acc + c.value, 0n);
  const paymentAmountXrp = await computeDirectMintingPaymentAmountXrp(ctx, { netMintAmountXrp });
  return {
    calls,
    memo: memoData,
    data,
    totalCallValue,
    nonce,
    paymentAmountXrp,
    destination,
    executorFeeUBA,
  };
}
