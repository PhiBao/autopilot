import { decodeAbiParameters, encodeFunctionData, toHex, type AbiParameter, type ContractFunctionArgs } from "viem";
import { iFdcHubAbi, iFdcRequestFeeConfigurationsAbi, iFdcVerificationAbi, iFlareSystemsManagerAbi, iRelayAbi, ixrpPaymentVerificationAbi } from "@flarenetwork/flare-wagmi-periphery-package/contracts/coston2";

import type { FlareContext, PublicFlareContext } from "./context";
import { getContractAddressByName } from "./contract-registry";
import { broadcastRaw } from "./write";

export type IXrpPaymentProof = ContractFunctionArgs<
  typeof  ixrpPaymentVerificationAbi,
  "view",
  "verifyXRPPayment"
>[0];
export type IXrpPaymentResponse = IXrpPaymentProof["data"];

const POLL_INTERVAL_MS = 30_000;
const DA_LAYER_POLL_MS = 10_000;
const RETRY_SLEEP_MS = 20_000;
const RETRY_ATTEMPTS = 10;

const iXrpPaymentResponseAbiParam = (
  ixrpPaymentVerificationAbi.find(
    (f: { type?: string; name?: string }) => f.type === "function" && f.name === "verifyXRPPayment"
  ) as { inputs: readonly { components?: readonly AbiParameter[] }[] } | undefined
)?.inputs?.[0]?.components?.[1];

function decodeXrpPaymentResponse(responseHex: `0x${string}`): IXrpPaymentResponse {
  if (!iXrpPaymentResponseAbiParam) {
    throw new Error("IXRPPayment.Response ABI not found on ixrpPaymentVerificationAbi.verifyXRPPayment");
  }
  const [decoded] = decodeAbiParameters([iXrpPaymentResponseAbiParam], responseHex);
  return decoded as IXrpPaymentResponse;
}

const FDC_ATTESTATION_TYPE_XRP_PAYMENT = "XRPPayment";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<{ statusCode: number; body: string }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const responseBody = await response.text();
  return { statusCode: response.status, body: responseBody };
}

export async function prepareAttestationRequest(
  verifierUrl: string,
  apiKey: string,
  attestationTypeBase: string,
  sourceIdBase: string,
  requestBody: Record<string, unknown>
): Promise<{ abiEncodedRequest: string; [key: string]: unknown }> {
  const attestationType = toHex(attestationTypeBase, { size: 32 });
  const sourceId = toHex(sourceIdBase, { size: 32 });

  const request = {
    attestationType,
    sourceId,
    requestBody,
  };

  const { statusCode, body } = await postJson(verifierUrl, request, { "X-API-KEY": apiKey });

  if (statusCode !== 200) {
    throw new Error(`FDC verifier returned status ${statusCode}`);
  }

  const data = JSON.parse(body) as { abiEncodedRequest?: string; status?: string; errorMessage?: string };
  if (data.status && !data.status.startsWith("OK") && data.status !== "VALID") {
    const detail = data.errorMessage ? ` (${data.errorMessage})` : "";
    throw new Error(`Verifier rejected request: ${data.status}${detail}`);
  }
  if (data.abiEncodedRequest === undefined) {
    throw new Error(`Verifier response missing abiEncodedRequest`);
  }
  return data as { abiEncodedRequest: string; [key: string]: unknown };
}

export async function submitAttestationRequest(
  ctx: FlareContext,
  abiEncodedRequest: `0x${string}`
): Promise<number> {
  const { publicClient, walletClient, executorAccount } = ctx;
  const fdcHubAddress = await getContractAddressByName(ctx, "FdcHub");
  const feeConfigAddress = await publicClient.readContract({
    address: fdcHubAddress,
    abi:  iFdcHubAbi,
    functionName: "fdcRequestFeeConfigurations",
    args: [],
  });
  const requestFee = await publicClient.readContract({
    address: feeConfigAddress,
    abi:  iFdcRequestFeeConfigurationsAbi,
    functionName: "getRequestFee",
    args: [abiEncodedRequest],
  });

  const data = encodeFunctionData({
    abi: iFdcHubAbi,
    functionName: "requestAttestation",
    args: [abiEncodedRequest],
  });
  const hash = await broadcastRaw(ctx, { to: fdcHubAddress, data, value: requestFee });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
  const blockTimestamp = BigInt(block.timestamp);

  const flareSystemsManagerAddress = await getContractAddressByName(ctx, "FlareSystemsManager");
  const [firstVotingRoundStartTs, votingEpochDurationSeconds] = await Promise.all([
    publicClient.readContract({
      address: flareSystemsManagerAddress,
      abi:  iFlareSystemsManagerAbi,
      functionName: "firstVotingRoundStartTs",
      args: [],
    }),
    publicClient.readContract({
      address: flareSystemsManagerAddress,
      abi:  iFlareSystemsManagerAbi,
      functionName: "votingEpochDurationSeconds",
      args: [],
    }),
  ]);

  const roundId = Number((blockTimestamp - firstVotingRoundStartTs) / votingEpochDurationSeconds);
  return roundId;
}

async function pollFdcProof<TResponse>(
  ctx: PublicFlareContext,
  abiEncodedRequest: string,
  roundId: number,
  decodeResponse: (hex: `0x${string}`) => TResponse
): Promise<{ merkleProof: readonly `0x${string}`[]; data: TResponse }> {
  const { publicClient } = ctx;
  const daLayerProofUrl =
    ctx.daLayerUrl.replace(/\/$/, "") + "/api/v1/fdc/proof-by-request-round-raw";
  const relayAddress = await getContractAddressByName(ctx, "Relay");
  const fdcVerificationAddress = await getContractAddressByName(ctx, "FdcVerification");
  const protocolId = await publicClient.readContract({
    address: fdcVerificationAddress,
    abi:  iFdcVerificationAbi,
    functionName: "fdcProtocolId",
    args: [],
  });

  while (true) {
    const finalized = await publicClient.readContract({
      address: relayAddress,
      abi:  iRelayAbi,
      functionName: "isFinalized",
      args: [BigInt(protocolId), BigInt(roundId)],
    });
    if (finalized) break;
    await sleep(POLL_INTERVAL_MS);
  }

  const request = { votingRoundId: roundId, requestBytes: abiEncodedRequest };
  await sleep(DA_LAYER_POLL_MS);

  for (let i = 0; i < RETRY_ATTEMPTS; i++) {
    const { body } = await postJson(daLayerProofUrl, request);
    const raw = JSON.parse(body) as { response_hex?: string; proof?: readonly `0x${string}`[] };
    if (raw.response_hex !== undefined) {
      return { merkleProof: raw.proof ?? [], data: decodeResponse(raw.response_hex as `0x${string}`) };
    }
    await sleep(DA_LAYER_POLL_MS);
  }
  throw new Error(`Failed to retrieve FDC proof after ${RETRY_ATTEMPTS} DA-layer polls`);
}

async function withRetry<T>(fn: () => Promise<T>, attempts: number, label: string): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      console.error(`[${label}] attempt ${i + 1}/${attempts} failed:`, e);
      await sleep(RETRY_SLEEP_MS);
    }
  }
  throw new Error(`Failed to ${label} after ${attempts} attempts`);
}

export async function prepareXrpPaymentRequest(
  ctx: FlareContext,
  {
    transactionId,
    proofOwner,
  }: {
    transactionId: `0x${string}`;
    proofOwner: `0x${string}`;
  }
): Promise<{ abiEncodedRequest: `0x${string}` }> {
  const verifierUrl = `${ctx.fdcVerifierUrl.replace(/\/$/, "")}/verifier/xrp/XRPPayment/prepareRequest`;
  const result = await prepareAttestationRequest(
    verifierUrl,
    ctx.fdcApiKey,
    FDC_ATTESTATION_TYPE_XRP_PAYMENT,
    ctx.fdcXrpSourceId,
    {
      transactionId,
      proofOwner,
    }
  );
  return { abiEncodedRequest: result.abiEncodedRequest as `0x${string}` };
}

export async function retrieveXrpPaymentProof(
  ctx: PublicFlareContext,
  abiEncodedRequest: `0x${string}`,
  roundId: number
): Promise<IXrpPaymentProof> {
  return pollFdcProof(ctx, abiEncodedRequest, roundId, decodeXrpPaymentResponse) as Promise<IXrpPaymentProof>;
}

export async function retrieveXrpPaymentProofWithRetry(
  ctx: PublicFlareContext,
  abiEncodedRequest: `0x${string}`,
  roundId: number,
  attempts: number = RETRY_ATTEMPTS
): Promise<IXrpPaymentProof> {
  return withRetry(
    () => retrieveXrpPaymentProof(ctx, abiEncodedRequest, roundId),
    attempts,
    "retrieve XRPPayment proof"
  );
}
