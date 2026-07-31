import { createPublicFlareContext } from "../lib/flare/context";
import { getVaults, getBalances } from "../lib/flare/smart-accounts";

const firelightVaultAbi = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_assets", type: "uint256" },
      { name: "_receiver", type: "address" },
    ],
    outputs: [{ name: "_shares", type: "uint256" }],
  },
  {
    type: "function",
    name: "redeem",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_shares", type: "uint256" },
      { name: "_receiver", type: "address" },
      { name: "_owner", type: "address" },
    ],
    outputs: [{ name: "_assets", type: "uint256" }],
  },
  {
    type: "function",
    name: "claimWithdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "_period", type: "uint256" }],
    outputs: [{ name: "_assets", type: "uint256" }],
  },
  {
    type: "function",
    name: "pendingRedemptionPeriod",
    stateMutability: "view",
    inputs: [{ name: "_account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "pendingRedemptionClaim",
    stateMutability: "view",
    inputs: [{ name: "_account", type: "address" }, { name: "_period", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "currentPeriod",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "asset",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

async function read(
  ctx: ReturnType<typeof createPublicFlareContext>,
  address: `0x${string}`,
  fn: string,
  args: readonly unknown[] = []
): Promise<string> {
  try {
    const r = (await ctx.publicClient.readContract({
      address,
      abi: firelightVaultAbi,
      functionName: fn as never,
      args: args as never,
    })) as bigint | string | undefined;
    return typeof r === "bigint" ? r.toString() : String(r ?? "");
  } catch (e) {
    return `ERR: ${(e as Error).message.slice(0, 120)}`;
  }
}

async function main() {
  const ctx = createPublicFlareContext("coston2");
  const vaults = await getVaults(ctx);
  const firelight = vaults.find((v) => v.type === 1)!;
  console.log("Firelight vault:", firelight.address);

  for (const [fn, args] of [
    ["currentPeriod", []],
    ["asset", []],
    ["pendingRedemptionPeriod", ["0xb95b7A47A23c3510746f446E91665826480c5A58"]],
    ["pendingRedemptionClaim", ["0xb95b7A47A23c3510746f446E91665826480c5A58", "0"]],
    ["balanceOf", ["0xb95b7A47A23c3510746f446E91665826480c5A58"]],
  ] as const) {
    console.log(`${fn}:`, await read(ctx, firelight.address, fn, args as unknown as readonly unknown[]));
  }

  const balances = await getBalances(ctx, "rLReZoi6KFGeDC6pZv6kNuAGzhaSyJ4CMb");
  for (const v of balances.vaults) {
    if (v.vaultType === 1) {
      console.log(`\nPosition: vaultId=${v.vaultId} shares=${v.shares} assets=${v.assets}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
