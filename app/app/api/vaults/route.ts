import { json } from "@/lib/server/json";
import { COSTON2_VAULTS, formatXrp } from "@/lib/flare/vaults";

export async function GET() {
  const vaults = COSTON2_VAULTS.map((v) => ({
    id: v.id.toString(),
    address: v.address,
    type: v.type,
    name: v.name,
    operator: v.operator,
    strategy: v.strategy,
    lockup: v.lockup,
    riskLevel: v.riskLevel,
    riskNotes: v.riskNotes,
    apyBps: v.apyBps,
    capXrp: v.capUBA !== null ? formatXrp(v.capUBA) : null,
    deployed: v.deployed ?? false,
  }));
  return json({ vaults });
}
