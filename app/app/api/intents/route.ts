import { json } from "@/lib/server/json";
import { getServerPublicContext } from "@/lib/server/context";
import { getPersonalAccountAddress } from "@/lib/flare/smart-accounts";
import { buildDepositIntent, buildExitIntent } from "@/lib/intent/engine";
import { getVaultProfile } from "@/lib/flare/vaults";
import { createIntent, now } from "@/lib/intent/model";
import { saveIntent, listIntentsByXrpl } from "@/lib/store";

const XRP_TO_UBA = BigInt(1_000_000);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const xrpl = searchParams.get("xrpl");
  if (!xrpl) return json({ error: "Missing xrpl" }, { status: 400 });
  const intents = await listIntentsByXrpl(xrpl);
  return json({ intents });
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    xrpl: string;
    kind: "deposit" | "exit";
    vaultAddress: string;
    amountXrp?: string;
    sharesUba?: string;
  };
  if (!body.xrpl || !body.vaultAddress || !body.kind) {
    return json({ error: "Missing required fields" }, { status: 400 });
  }
  const vault = getVaultProfile(body.vaultAddress as `0x${string}`);
  if (!vault) return json({ error: "Unknown vault" }, { status: 400 });

  const ctx = getServerPublicContext();
  const personalAccount = await getPersonalAccountAddress(ctx, body.xrpl);

  try {
    let intent;
    if (body.kind === "deposit") {
      const amountUba = BigInt(Math.round(Number(body.amountXrp ?? "1") * 1_000_000));
      if (amountUba <= 0n) return json({ error: "Invalid amount" }, { status: 400 });
      intent = await buildDepositIntent(ctx, {
        xrplAddress: body.xrpl,
        personalAccount,
        vault,
        amountUBA: amountUba,
      });
    } else {
      const shares = BigInt(body.sharesUba ?? "0");
      if (shares <= 0n) return json({ error: "Invalid shares" }, { status: 400 });
      intent = await buildExitIntent(ctx, {
        xrplAddress: body.xrpl,
        personalAccount,
        vault,
        shares,
      });
    }
    await saveIntent(intent);
    return json({ intent });
  } catch (e) {
    return json({ error: (e as Error).message }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
