import { json } from "@/lib/server/json";
import { getServerPublicContext } from "@/lib/server/context";
import { getPersonalAccountAddress, getBalances, type VaultBalance } from "@/lib/flare/smart-accounts";
import { getFxrpBalance } from "@/lib/flare/fassets";
import { getVaultProfile, formatXrp, AUTOPILOT_VAULT_ADDRESS, firelightVaultAbi } from "@/lib/flare/vaults";
import { getXrpBalance } from "@/lib/flare/xrpl";

function vaultPosition(profile: ReturnType<typeof getVaultProfile>, b: VaultBalance) {
  if (!profile) return null;
  return {
    vaultId: b.vaultId.toString(),
    vaultAddress: b.vaultAddress,
    name: profile.name,
    operator: profile.operator,
    type: profile.type,
    riskLevel: profile.riskLevel,
    strategy: profile.strategy,
    lockup: profile.lockup,
    shares: b.shares.toString(),
    assets: b.assets.toString(),
    assetsXrp: formatXrp(b.assets),
    apyBps: profile.apyBps,
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const xrpl = searchParams.get("xrpl");
  if (!xrpl) {
    return json({ error: "Missing xrpl" }, { status: 400 });
  }
  try {
    const ctx = getServerPublicContext();
    const personalAccount = await getPersonalAccountAddress(ctx, xrpl);
    const [balances, fxrpUba, xrpBalance] = await Promise.all([
      getBalances(ctx, xrpl),
      getFxrpBalance(ctx, personalAccount),
      getXrpBalance(xrpl).catch(() => 0),
    ]);

    const vaults = balances.vaults
      .map((b) => vaultPosition(getVaultProfile(b.vaultAddress), b))
      .filter((v) => v !== null);

    // Include our deployed demo vault (not registered with MasterAccountController),
    // reading its position directly.
    const demoProfile = getVaultProfile(AUTOPILOT_VAULT_ADDRESS);
    if (demoProfile) {
      try {
        const shares = (await ctx.publicClient.readContract({
          address: AUTOPILOT_VAULT_ADDRESS,
          abi: firelightVaultAbi,
          functionName: "balanceOf",
          args: [personalAccount],
        })) as bigint;
        const assets = (await ctx.publicClient.readContract({
          address: AUTOPILOT_VAULT_ADDRESS,
          abi: firelightVaultAbi,
          functionName: "convertToAssets",
          args: [shares],
        })) as bigint;
        if (shares > 0n || assets > 0n) {
          vaults.push({
            vaultId: demoProfile.id.toString(),
            vaultAddress: AUTOPILOT_VAULT_ADDRESS,
            name: demoProfile.name,
            operator: demoProfile.operator,
            type: demoProfile.type,
            riskLevel: demoProfile.riskLevel,
            strategy: demoProfile.strategy,
            lockup: demoProfile.lockup,
            shares: shares.toString(),
            assets: assets.toString(),
            assetsXrp: formatXrp(assets),
            apyBps: demoProfile.apyBps,
          });
        }
      } catch {
        /* demo vault may not be deployed on this network */
      }
    }

    return json({
      xrpl,
      personalAccount,
      xrpBalance,
      fxrp: formatXrp(fxrpUba),
      fxrpUba: fxrpUba.toString(),
      natUba: balances.natBalance.toString(),
      vaults,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, { status: 500 });
  }
}
