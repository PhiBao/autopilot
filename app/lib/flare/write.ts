import type { Address, Hex } from "viem";
import type { FlareContext } from "./context";
import { EXECUTOR_GAS_FEES } from "./fees";

/** Default gas for executor writes. The direct-mint + userOp tx is large (~1M gas worst case). */
export const EXECUTOR_GAS = 1_200_000n;

/**
 * Broadcast a raw transaction to the Flare RPC with explicit gas, fees, and a
 * locally-managed nonce, retrying once after a nonce re-sync.
 *
 * viem's `writeContract` performs fee/gas estimation that can produce values the
 * Coston2 public node rejects ("Missing or invalid parameters"). Signing with
 * explicit parameters and submitting the raw tx via the JSON-RPC HTTP endpoint
 * is deterministic and surfaces the node's real error when something is wrong.
 */
export async function broadcastRaw(
  ctx: FlareContext,
  { to, data, value = 0n, gas = EXECUTOR_GAS }: { to: Address; data: Hex; value?: bigint; gas?: bigint }
): Promise<`0x${string}`> {
  let nonce = await ctx.nonceTracker.nextNonce();
  const sign = (n: number) =>
    ctx.walletClient.signTransaction({
      account: ctx.executorAccount,
      chain: ctx.chain,
      to,
      data,
      value,
      gas,
      nonce: n,
      ...EXECUTOR_GAS_FEES,
    });

  try {
    return await submitRaw(ctx, await sign(nonce));
  } catch (error) {
    await ctx.nonceTracker.resync();
    nonce = await ctx.nonceTracker.nextNonce();
    try {
      return await submitRaw(ctx, await sign(nonce));
    } catch (secondError) {
      const detail =
        (secondError as { details?: string }).details ??
        (secondError as { cause?: unknown }).cause?.toString() ??
        "";
      const signedPreview = await sign(nonce).catch(() => "");
      throw new Error(
        `broadcast failed (nonce ${nonce}): ${(secondError as Error).message}\n${detail}\nsigned: ${signedPreview}`,
        { cause: error }
      );
    }
  }
}

async function submitRaw(ctx: FlareContext, signed: Hex): Promise<`0x${string}`> {
  const res = await fetch(ctx.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [signed] }),
  });
  const body = (await res.json()) as { result?: `0x${string}`; error?: { code: number; message: string } };
  if (body.error) {
    const err = new Error(`RPC ${body.error.code}: ${body.error.message}`);
    (err as { details?: string }).details = body.error.message;
    throw err;
  }
  return body.result!;
}
