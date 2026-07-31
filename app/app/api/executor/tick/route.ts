import { json } from "@/lib/server/json";
import { getServerContext } from "@/lib/server/context";
import { tickExecutor } from "@/lib/executor/scheduler";
import { listActiveIntents, saveIntent } from "@/lib/store";

/**
 * Executor tick — driven by a cron/worker or by the UI's polling loop.
 * Advances every active intent: promotes timed steps to "needs signature"
 * and delivers any signed step's userOp through the FDC attestation flow.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { xrpl?: string };
  const ctx = getServerContext();
  const report = await tickExecutor(
    ctx,
    {
      loadActive: listActiveIntents,
      save: saveIntent,
    },
    body.xrpl
  );
  return json(report);
}
