import { createFlareContext } from "../lib/flare/context";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FXRP_COSTON2 = "0x0b6A3645c240605887a5532109323A3E12273dc7" as const;
const PERIOD_DURATION = 60; // seconds — fast demo periods
const LAG = 15; // seconds — claimable shortly after the period rolls

const artifact = JSON.parse(
  readFileSync(resolve(__dirname, "../../contracts/out/AutopilotVault.sol/AutopilotVault.json"), "utf8")
) as { abi: readonly unknown[]; bytecode: { object: string } };

async function main() {
  const ctx = createFlareContext("coston2");
  const deployer = ctx.executorAccount.address;
  const balance = await ctx.publicClient.getBalance({ address: deployer });
  console.log("Deployer:", deployer, "C2FLR:", (Number(balance) / 1e18).toFixed(2));

  const hash = await ctx.walletClient.deployContract({
    account: ctx.executorAccount,
    chain: ctx.chain,
    abi: artifact.abi,
    bytecode: artifact.bytecode.object as `0x${string}`,
    args: [FXRP_COSTON2, BigInt(PERIOD_DURATION), BigInt(LAG)],
  });
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  console.log("Deployed AutopilotVault at:", receipt.contractAddress);
  console.log("Tx:", hash);
  console.log(`PeriodDuration=${PERIOD_DURATION}s Lag=${LAG}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
