import type { Address, PublicClient } from "viem";

type NonceClient = Pick<PublicClient, "getTransactionCount">;

/**
 * In-process nonce tracker for the executor account.
 *
 * Avalanche C-chain nodes can return a stale `eth_getTransactionCount('pending')`
 * immediately after a transaction is broadcast, so two rapid writes from the same
 * account can read the same nonce and one gets rejected. This tracker maintains a
 * local counter, re-syncing from the chain only when it falls behind.
 */
export class NonceTracker {
  private next: number | null = null;
  private lastUsedAt = 0;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private client: NonceClient,
    private address: Address
  ) {}

  private async sync() {
    const pending = await this.client.getTransactionCount({ address: this.address, blockTag: "pending" });
    const confirmed = await this.client.getTransactionCount({ address: this.address });
    this.next = pending > confirmed ? pending : confirmed;
  }

  /** Claim the next nonce for a write. Concurrent callers serialize on an internal chain. */
  nextNonce(): Promise<number> {
    const result = this.chain.then(async () => {
      const now = Date.now();
      if (this.next === null || now - this.lastUsedAt > 10_000) {
        await this.sync();
      }
      if (this.next === null) {
        await this.sync();
      }
      const nonce = this.next as number;
      this.next = nonce + 1;
      this.lastUsedAt = now;
      return nonce;
    });
    this.chain = result.catch(() => undefined);
    return result;
  }

  /** Recover from a rejected broadcast: re-sync from the chain. */
  async resync(): Promise<void> {
    this.next = null;
    await this.sync();
  }
}
