import type { Address } from "viem";
import { iMemoInstructionsFacetAbi } from "@flarenetwork/flare-wagmi-periphery-package/contracts/coston2";

import type { PublicFlareContext } from "./context";
import { getMasterAccountControllerAddress } from "./contract-registry";

export async function getNonce(
  ctx: PublicFlareContext,
  personalAccount: Address
): Promise<bigint> {
  return ctx.publicClient.readContract({
    address: await getMasterAccountControllerAddress(ctx),
    abi:  iMemoInstructionsFacetAbi,
    functionName: "getNonce",
    args: [personalAccount],
  }) as Promise<bigint>;
}
