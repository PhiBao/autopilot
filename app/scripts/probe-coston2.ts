import { createPublicFlareContext } from "../lib/flare/context";
import {
  getMasterAccountControllerAddress,
  getAssetManagerFXRPAddress,
  getFxrpAddress,
  getDirectMintingPaymentAddress,
} from "../lib/flare/contract-registry";
import { getVaults, getOperatorXrplAddresses, getPersonalAccountAddress } from "../lib/flare/smart-accounts";
import { getNonce } from "../lib/flare/nonce";
import { getDirectMintingExecutorFeeUBA } from "../lib/flare/fassets";

async function main() {
  const ctx = createPublicFlareContext("coston2");
  console.log("RPC:", ctx.rpcUrl);

  const [mac, am, fxrp, dmAddr] = await Promise.all([
    getMasterAccountControllerAddress(ctx),
    getAssetManagerFXRPAddress(ctx),
    getFxrpAddress(ctx),
    getDirectMintingPaymentAddress(ctx),
  ]);
  console.log("MasterAccountController:", mac);
  console.log("AssetManagerFXRP:", am);
  console.log("FXRP token:", fxrp);
  console.log("DirectMintingPaymentAddress (XRPL):", dmAddr);

  const vaults = await getVaults(ctx);
  console.log("\nRegistered vaults:", vaults.length);
  for (const v of vaults) {
    console.log(`  vaultId=${v.id} type=${v.type} address=${v.address}`);
  }

  const ops = await getOperatorXrplAddresses(ctx);
  console.log("\nXRPL provider wallets:", ops);

  const execFee = await getDirectMintingExecutorFeeUBA(ctx);
  console.log("\nDirectMintingExecutorFeeUBA:", execFee.toString(), "(" + Number(execFee) / 1e6 + " XRP)");

  // Example: resolve a personal account for a test XRPL address (from the flare-viem-starter docs)
  const exampleXrpl = "rBtyQXCJ3F4zBfTnWZzZvQm1bCqHmLxDbP";
  const pa = await getPersonalAccountAddress(ctx, exampleXrpl);
  console.log(`\nPersonalAccount for ${exampleXrpl}: ${pa}`);
  const nonce = await getNonce(ctx, pa);
  console.log("Nonce:", nonce.toString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
