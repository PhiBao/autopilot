import type { Address, PublicClient } from "viem";
import {
  iAssetManagerAbi,
  iDirectMintingAbi,
  iFlareContractRegistryAbi,
} from "@flarenetwork/flare-wagmi-periphery-package/contracts/coston2";

import { FLARE_CONTRACT_REGISTRY_ADDRESS } from "./config";
import type { PublicFlareContext } from "./context";

export type FlareContractName =
  | "MasterAccountController"
  | "AssetManagerFXRP"
  | "FdcHub"
  | "FlareSystemsManager"
  | "Relay"
  | "FdcVerification"
  | "FtsoV2PriceOracle"
  | "FtsoV2Interface";

export async function getContractAddressByName(
  ctx: Pick<PublicFlareContext, "publicClient">,
  name: FlareContractName
): Promise<Address> {
  return ctx.publicClient.readContract({
    address: FLARE_CONTRACT_REGISTRY_ADDRESS,
    abi:  iFlareContractRegistryAbi,
    functionName: "getContractAddressByName",
    args: [name],
  });
}

export async function getMasterAccountControllerAddress(
  ctx: Pick<PublicFlareContext, "publicClient">
): Promise<Address> {
  return getContractAddressByName(ctx, "MasterAccountController");
}

export async function getAssetManagerFXRPAddress(
  ctx: Pick<PublicFlareContext, "publicClient">
): Promise<Address> {
  return getContractAddressByName(ctx, "AssetManagerFXRP");
}

export async function getFxrpAddress(ctx: PublicFlareContext): Promise<Address> {
  const assetManagerAddress = await getAssetManagerFXRPAddress(ctx);
  return ctx.publicClient.readContract({
    address: assetManagerAddress,
    abi:  iAssetManagerAbi,
    functionName: "fAsset",
  });
}

export async function getDirectMintingPaymentAddress(
  ctx: PublicFlareContext
): Promise<string> {
  const assetManagerAddress = await getAssetManagerFXRPAddress(ctx);
  return ctx.publicClient.readContract({
    address: assetManagerAddress,
    abi:  iDirectMintingAbi,
    functionName: "directMintingPaymentAddress",
  });
}
