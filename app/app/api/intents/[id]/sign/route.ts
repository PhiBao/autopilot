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
 *    and reports the transaction hash.
 *  - `{ demoSign: true }` — (demo only) Autopilot signs the payment with the
 *    demo testnet wallet on the user's behalf, using the exact destination,
 *    amount and 0xFE memo prepared for the step.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const intent = await getIntent(id);
  if (!intent) return json({ error: "Intent not found" }, { status: 404 });

  const body = (await req.json()) as { xrplTxHash?: string; demoSign?: boolean };
  const step = intent.steps.find((s) => s.status === "pending_sign");
  if (!step) return json({ error: "No step awaiting signature" }, { status: 409 });
  if (!step.userOp) return json({ error: "Step has no prepared userOp" }, { status: 409 });

  let xrplTxHash = body.xrplTxHash;

  if (body.demoSign) {
    const seed = process.env.XRPL_DEMO_SEED;
    if (!seed) return json({ error: "Demo signing not configured" }, { status: 500 });
    const ctx = getServerContext();
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
