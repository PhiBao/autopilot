import { json } from "@/lib/server/json";
import { getServerPublicContext } from "@/lib/server/context";
import { getPersonalAccountAddress, isPersonalAccountDeployed } from "@/lib/flare/smart-accounts";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const xrpl = searchParams.get("xrpl");
  if (!xrpl || !/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(xrpl)) {
    return json({ error: "Invalid XRPL address" }, { status: 400 });
  }
  try {
    const ctx = getServerPublicContext();
    const personalAccount = await getPersonalAccountAddress(ctx, xrpl);
    const deployed = await isPersonalAccountDeployed(ctx, xrpl);
    return json({ xrpl, personalAccount, deployed });
  } catch (e) {
    return json({ error: (e as Error).message }, { status: 500 });
  }
}
