import { createPublicFlareContext } from "../lib/flare/context";
import { getVaults } from "../lib/flare/smart-accounts";

const erc20MinimalAbi = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalAssets", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "asset", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

async function tryRead(
  ctx: ReturnType<typeof createPublicFlareContext>,
  address: `0x${string}`,
  fn: string
): Promise<bigint | string> {
  try {
    const result = await ctx.publicClient.readContract({
      address,
      abi: erc20MinimalAbi,
      functionName: fn as never,
      args: fn === "balanceOf" ? ["0x434936d47503353f06750Db1A444DBDC5F0AD37c"] : [],
    });
    return typeof result === "bigint" ? result : String(result);
  } catch (e) {
    return `ERR: ${(e as Error).message.slice(0, 80)}`;
  }
}

async function main() {
  const ctx = createPublicFlareContext("coston2");
  const vaults = await getVaults(ctx);
  for (const v of vaults) {
    console.log(`\n=== vaultId=${v.id} type=${v.type} ${v.address} ===`);
    const name = v.type === 1 ? "Firelight" : "Upshift";
    console.log(`kind: ${name}`);
    for (const fn of ["decimals", "totalSupply", "totalAssets", "asset", "balanceOf"]) {
    const res = await tryRead(ctx, v.address, fn);
    const pretty = typeof res === "bigint" ? res.toString() : String(res);
      console.log(`  ${fn}: ${pretty}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
