import { json } from "@/lib/server/json";
import { getServerContext } from "@/lib/server/context";
import { getIntent, saveIntent } from "@/lib/store";
import { Client, Wallet } from "xrpl";
import { sendXrplPayment } from "@/lib/flare/xrpl";
import { reconcileIntent, now } from "@/lib/intent/model";

/**
 * Mark the user's signature for a pending step.
 *
 * Two modes:
 *  - `{ xrplTxHash }` — the user signed the XRPL payment in their own wallet
 *    and reports the transaction hash. The tx is validated on the XRPL ledger
 *    (sender, destination and memo must match the prepared payment).
 *  - `{ demoSign: true }` — (demo only) Autopilot signs with the demo testnet
 *    wallet. Only valid when the intent belongs to the demo wallet (the on-chain
 *    sender check requires the signing wallet's personal account to match).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const intent = await getIntent(id);
  if (!intent) return json({ error: "Intent not found" }, { status: 404 });

  const body = (await req.json()) as { xrplTxHash?: string; demoSign?: boolean };
  const step = intent.steps.find((s) => s.status === "pending_sign");
  if (!step) return json({ error: "No step awaiting signature" }, { status: 409 });
  if (!step.userOp) return json({ error: "Step has no prepared userOp" }, { status: 409 });

  const ctx = getServerContext();
  let xrplTxHash = body.xrplTxHash;

  if (body.demoSign) {
    const demoAddress = process.env.XRPL_DEMO_ADDRESS;
    if (intent.xrplAddress.toLowerCase() !== (demoAddress ?? "").toLowerCase()) {
      return json(
        { error: "Demo signing only works for the demo wallet — connect your own wallet and sign there" },
        { status: 400 }
      );
    }
    const seed = process.env.XRPL_DEMO_SEED;
    if (!seed) return json({ error: "Demo signing not configured" }, { status: 500 });
    const xrplClient = new Client(ctx.xrplRpcUrl);
    const wallet = Wallet.fromSeed(seed);
    const memoHex = step.userOp.memo.slice(2);
    const tx = await sendXrplPayment({
      destination: step.userOp.destination,
      amount: step.userOp.paymentAmountXrp,
      memos: [{ Memo: { MemoData: memoHex } }],
      wallet,
      client: xrplClient,
    });
    xrplTxHash = tx.result.hash;
  } else if (xrplTxHash) {
    // Validate the user's own signature against the XRPL ledger.
    const err = await validateSignedPayment(ctx, intent.xrplAddress, step.userOp, xrplTxHash);
    if (err) return json({ error: err }, { status: 400 });
  }

  if (!xrplTxHash) {
    return json({ error: "Provide xrplTxHash or demoSign" }, { status: 400 });
  }

  const steps = intent.steps.map((s) =>
    s.id === step.id
      ? { ...s, status: "signed" as const, xrplTxHash, updatedAt: now() }
      : s
  );
  const updated = reconcileIntent({ ...intent, steps, updatedAt: now() });
  await saveIntent(updated);
  return json({ intent: updated, xrplTxHash });
}

/** Verify a user-signed XRPL Payment matches the prepared payment (sender, destination, memo). */
async function validateSignedPayment(
  ctx: ReturnType<typeof getServerContext>,
  xrplAddress: string,
  userOp: { destination: string; memo: string },
  txHash: string
): Promise<string | null> {
  const client = new Client(ctx.xrplRpcUrl);
  try {
    await client.connect();
    const res = await client.request({ command: "tx", transaction: txHash });
    const tx = res.result as unknown as {
      tx_json?: { Account?: string; Destination?: string; Memos?: { Memo: { MemoData?: string } }[]; TransactionType?: string };
      meta?: { TransactionResult?: string };
    };
    const t = tx.tx_json;
    if (tx.meta?.TransactionResult && tx.meta.TransactionResult !== "tesSUCCESS") {
      return `The transaction was not successful on the ledger (${tx.meta.TransactionResult})`;
    }
    if (!t || t.TransactionType !== "Payment") return "The reported transaction is not an XRPL Payment";
    if ((t.Account ?? "").toLowerCase() !== xrplAddress.toLowerCase()) {
      return "This payment was not sent from your connected XRPL address";
    }
    if ((t.Destination ?? "").toLowerCase() !== userOp.destination.toLowerCase()) {
      return "The payment destination does not match the one Autopilot prepared";
    }
    const memo = t.Memos?.[0]?.Memo?.MemoData ?? "";
    if (memo.toLowerCase() !== userOp.memo.slice(2).toLowerCase()) {
      return "The payment memo does not match — use the memo Autopilot prepared (copy it)";
    }
    return null;
  } catch (e) {
    return `Could not find the transaction on the XRPL ledger: ${(e as Error).message.slice(0, 120)}`;
  } finally {
    await client.disconnect().catch(() => undefined);
  }
}
