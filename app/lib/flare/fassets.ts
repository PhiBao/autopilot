import { type Address, erc20Abi } from "viem";
import { iAssetManagerAbi, iDirectMintingSettingsAbi } from "@flarenetwork/flare-wagmi-periphery-package/contracts/coston2";

import { dropsToXrp, xrpToDrops } from "xrpl";
import type { PublicFlareContext } from "./context";
import { getAssetManagerFXRPAddress, getContractAddressByName, getFxrpAddress } from "./contract-registry";

const MAX_REDEMPTION_QUEUE_PAGES = 100;

export async function getFxrpBalance(ctx: PublicFlareContext, address: Address): Promise<bigint> {
  const fxrpAddress = await getFxrpAddress(ctx);
  return ctx.publicClient.readContract({
    address: fxrpAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  });
}

export async function getFxrpDecimals(ctx: PublicFlareContext): Promise<number> {
  const fxrpAddress = await getFxrpAddress(ctx);
  return ctx.publicClient.readContract({
    address: fxrpAddress,
    abi: erc20Abi,
    functionName: "decimals",
    args: [],
  });
}

export async function getRedemptionQueueTotalValueUBA(
  ctx: PublicFlareContext,
  assetManagerAddress?: Address
): Promise<bigint> {
  const address = assetManagerAddress ?? (await getAssetManagerFXRPAddress(ctx));
  const settings = await ctx.publicClient.readContract({
    address,
    abi:  iAssetManagerAbi,
    functionName: "getSettings",
  });
  const pageSize = BigInt(settings.maxRedeemedTickets);

  let totalValueUBA = 0n;
  let firstRedemptionTicketId = 0n;

  for (let page = 0; page < MAX_REDEMPTION_QUEUE_PAGES; page++) {
    const [queue, nextRedemptionTicketId] = await ctx.publicClient.readContract({
      address,
      abi:  iAssetManagerAbi,
      functionName: "redemptionQueue",
      args: [firstRedemptionTicketId, pageSize],
    });

    for (const ticket of queue) {
      totalValueUBA += ticket.ticketValueUBA;
    }

    if (nextRedemptionTicketId === 0n) {
      return totalValueUBA;
    }
    firstRedemptionTicketId = nextRedemptionTicketId;
  }

  throw new Error(`Redemption queue pagination exceeded ${MAX_REDEMPTION_QUEUE_PAGES} pages.`);
}

export async function getMinimumRedeemAmountUBA(
  ctx: PublicFlareContext,
  assetManagerAddress?: Address
): Promise<bigint> {
  const address = assetManagerAddress ?? (await getAssetManagerFXRPAddress(ctx));
  return ctx.publicClient.readContract({
    address,
    abi:  iAssetManagerAbi,
    functionName: "minimumRedeemAmountUBA",
  });
}

export async function computeDirectMintingPaymentAmountXrp(
  ctx: PublicFlareContext,
  { netMintAmountXrp }: { netMintAmountXrp: number }
): Promise<number> {
  const assetManagerAddress = await getContractAddressByName(ctx, "AssetManagerFXRP");
  const [executorFeeUBA, feeBIPS, minimumFeeUBA] = await Promise.all([
    ctx.publicClient.readContract({
      address: assetManagerAddress,
      abi:  iDirectMintingSettingsAbi,
      functionName: "getDirectMintingExecutorFeeUBA",
    }),
    ctx.publicClient.readContract({
      address: assetManagerAddress,
      abi:  iDirectMintingSettingsAbi,
      functionName: "getDirectMintingFeeBIPS",
    }),
    ctx.publicClient.readContract({
      address: assetManagerAddress,
      abi:  iDirectMintingSettingsAbi,
      functionName: "getDirectMintingMinimumFeeUBA",
    }),
  ]);

  const netMintUBA = BigInt(xrpToDrops(netMintAmountXrp));
  const proportionalFeeUBA = (netMintUBA * feeBIPS) / 10_000n;
  const mintingFeeUBA = proportionalFeeUBA > minimumFeeUBA ? proportionalFeeUBA : minimumFeeUBA;
  const totalUBA = netMintUBA + mintingFeeUBA + executorFeeUBA;

  return Number(dropsToXrp(totalUBA.toString()));
}

export async function getDirectMintingExecutorFeeUBA(
  ctx: PublicFlareContext
): Promise<bigint> {
  const assetManagerAddress = await getAssetManagerFXRPAddress(ctx);
  return ctx.publicClient.readContract({
    address: assetManagerAddress,
    abi:  iDirectMintingSettingsAbi,
    functionName: "getDirectMintingExecutorFeeUBA",
  });
}
