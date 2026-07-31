/**
 * Coston2's public node enforces a pool minimum gas fee cap of 500 gwei.
 * viem's fee estimation can produce values below this, and the node then
 * rejects the broadcast with a misleading "Missing or invalid parameters"
 * error. Set explicit, comfortably-above-minimum fees for all executor writes.
 */
export const EXECUTOR_GAS_FEES = {
  maxFeePerGas: 550_000_000_000n, // 550 gwei — above the 500 gwei pool minimum
  maxPriorityFeePerGas: 200_000_000_000n, // 200 gwei priority
} as const;
