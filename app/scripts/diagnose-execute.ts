import { createFlareContext } from "../lib/flare/context";
import { getAssetManagerFXRPAddress } from "../lib/flare/contract-registry";
import { getPersonalAccountAddress, normalizeXrplTransactionId } from "../lib/flare/smart-accounts";
import { prepareXrpPaymentRequest, submitAttestationRequest, retrieveXrpPaymentProofWithRetry } from "../lib/flare/fdc";
import { waitForXrplFinality } from "../lib/flare/xrpl";
import { EXECUTOR_GAS_FEES } from "../lib/flare/fees";
import { Client } from "xrpl";
import { encodeFunctionData, type Hex, type Address } from "viem";
import { readFileSync } from "node:fs";
import { iDirectMintingAbi } from "@flarenetwork/flare-wagmi-periphery-package/contracts/coston2";

async function main() {
  const ctx = createFlareContext("coston2");
  const store = JSON.parse(readFileSync("./.data/intents.json", "utf8"));
  const intent = Object.values(store)[0] as {
    xrplAddress: string;
    personalAccount: Address;
    steps: { xrplTxHash?: string; userOp?: { data: Hex } }[];
  };
  const userOpData = intent.steps[0].userOp!.data;
  const targetHash = intent.steps[0].xrplTxHash;
  if (!targetHash) throw new Error("no xrplTxHash in store");
  console.log("XRPL tx:", targetHash);

  const xrplClient = new Client(ctx.xrplRpcUrl);
  await waitForXrplFinality({ client: xrplClient, transactionHash: targetHash });
  const txId = normalizeXrplTransactionId(targetHash);
  const { abiEncodedRequest } = await prepareXrpPaymentRequest(ctx, {
    transactionId: txId,
    proofOwner: ctx.executorAccount.address,
  });
  const roundId = await submitAttestationRequest(ctx, abiEncodedRequest);
  const proof = await retrieveXrpPaymentProofWithRetry(ctx, abiEncodedRequest, roundId);
  console.log("proof obtained round:", proof.data.votingRound);

  const callData = encodeFunctionData({
    abi: iDirectMintingAbi,
    functionName: "executeDirectMintingWithData",
    args: [proof, userOpData],
  });
  console.log("callData len:", callData.length);

  const assetManager = await getAssetManagerFXRPAddress(ctx);
  const nonce = await ctx.publicClient.getTransactionCount({ address: ctx.executorAccount.address });
  const signed = await ctx.walletClient.signTransaction({
    account: ctx.executorAccount,
    chain: ctx.chain,
    to: assetManager,
    value: 0n,
    data: callData,
    gas: 700000n,
    nonce,
    ...EXECUTOR_GAS_FEES,
  });

  const res = await fetch("https://coston2-api.flare.network/ext/C/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [signed] }),
  });
  const body = await res.text();
  console.log("NODE RESPONSE:", body.slice(0, 600));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
