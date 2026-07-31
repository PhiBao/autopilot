import {
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  fromHex,
  keccak256,
  padHex,
  parseEventLogs,
  toHex,
  type Address,
  type TransactionReceipt,
} from "viem";
import { dropsToXrp, type Client, type Wallet } from "xrpl";
import {
  iDirectMintingAbi,
  iMasterAccountControllerAbi,
  iMemoInstructionsFacetAbi,
  iPersonalAccountAbi,
  iReaderFacetAbi,
} from "@flarenetwork/flare-wagmi-periphery-package/contracts/coston2";

import type { FlareContext, PublicFlareContext } from "./context";
import {
  getAssetManagerFXRPAddress,
  getDirectMintingPaymentAddress,
  getMasterAccountControllerAddress,
} from "./contract-registry";
import { getNonce } from "./nonce";
import { computeDirectMintingPaymentAmountXrp } from "./fassets";
import { broadcastRaw } from "./write";
import { XRPL_FDC_CONFIRMATIONS, waitForXrplFinality, sendXrplPayment } from "./xrpl";
import {
  prepareXrpPaymentRequest,
  retrieveXrpPaymentProofWithRetry,
  submitAttestationRequest,
  type IXrpPaymentProof,
} from "./fdc";

export const PAYMENT_ALREADY_CONFIRMED_SIGNATURE = "0x18dce79f" as const;

export type Call = {
  target: Address;
  value: bigint;
  data: `0x${string}`;
};

export type Vault = {
  id: bigint;
  address: Address;
  type: number;
};

export type VaultBalance = {
  vaultId: bigint;
  vaultAddress: Address;
  vaultType: number;
  shares: bigint;
  assets: bigint;
};

export type AccountBalances = {
  natBalance: bigint;
  wNat: { token: Address; balance: bigint };
  fXrp: { token: Address; balance: bigint };
  vaults: VaultBalance[];
};

export type UserOperationExecutedLog = {
  personalAccount: Address;
  nonce: bigint;
};

const ZERO_BYTES32 = ("0x" + "00".repeat(32)) as `0x${string}`;

const PACKED_USER_OPERATION_TUPLE = {
  type: "tuple",
  components: [
    { name: "sender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "initCode", type: "bytes" },
    { name: "callData", type: "bytes" },
    { name: "accountGasLimits", type: "bytes32" },
    { name: "preVerificationGas", type: "uint256" },
    { name: "gasFees", type: "bytes32" },
    { name: "paymasterAndData", type: "bytes" },
    { name: "signature", type: "bytes" },
  ],
} as const;

export function normalizeXrplTransactionId(hash: string): `0x${string}` {
  return (hash.startsWith("0x") ? hash : `0x${hash}`).toLowerCase() as `0x${string}`;
}

export function isPaymentAlreadyConfirmedError(error: unknown): boolean {
  let current: unknown = error;
  while (current != null && typeof current === "object") {
    const candidate = current as { signature?: string; raw?: string; cause?: unknown };
    if (
      candidate.signature === PAYMENT_ALREADY_CONFIRMED_SIGNATURE ||
      candidate.raw === PAYMENT_ALREADY_CONFIRMED_SIGNATURE
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

// --- Read state ------------------------------------------------------------

export async function getPersonalAccountAddress(
  ctx: PublicFlareContext,
  xrplAddress: string
): Promise<Address> {
  return ctx.publicClient.readContract({
    address: await getMasterAccountControllerAddress(ctx),
    abi:  iMasterAccountControllerAbi,
    functionName: "getPersonalAccount",
    args: [xrplAddress],
  });
}

export async function isPersonalAccountDeployed(
  ctx: PublicFlareContext,
  xrplAddress: string
): Promise<boolean> {
  const personalAccount = await getPersonalAccountAddress(ctx, xrplAddress);
  const code = await ctx.publicClient.getCode({ address: personalAccount });
  return code !== undefined && code !== "0x";
}

export async function getVaults(ctx: PublicFlareContext): Promise<Vault[]> {
  const _vaults = (await ctx.publicClient.readContract({
    address: await getMasterAccountControllerAddress(ctx),
    abi:  iMasterAccountControllerAbi,
    functionName: "getVaults",
    args: [],
  })) as [bigint[], string[], number[]];

  const length = _vaults[0].length;
  if (length === 0) {
    return [];
  }
  const vaults = new Array(length) as Vault[];
  _vaults[0].forEach((id, index) => {
    vaults[index] = {
      id,
      address: _vaults[1][index] as Address,
      type: _vaults[2][index]!,
    };
  });
  return vaults;
}

export async function getBalances(
  ctx: PublicFlareContext,
  xrplOwner: string
): Promise<AccountBalances> {
  const masterAccountControllerAddress = await getMasterAccountControllerAddress(ctx);
  const balances = await ctx.publicClient.readContract({
    address: masterAccountControllerAddress,
    abi: iReaderFacetAbi,
    functionName: "getBalances",
    args: [xrplOwner],
  });
  return {
    natBalance: balances.natBalance,
    wNat: balances.wNat,
    fXrp: balances.fXrp,
    vaults: [...balances.vaults],
  };
}

export async function getExecutor(
  ctx: PublicFlareContext,
  personalAccount: Address
): Promise<Address> {
  return ctx.publicClient.readContract({
    address: await getMasterAccountControllerAddress(ctx),
    abi:  iMemoInstructionsFacetAbi,
    functionName: "getExecutor",
    args: [personalAccount],
  });
}

export async function getOperatorXrplAddresses(ctx: PublicFlareContext): Promise<string[]> {
  const addresses = await ctx.publicClient.readContract({
    address: await getMasterAccountControllerAddress(ctx),
    abi: iMasterAccountControllerAbi,
    functionName: "getXrplProviderWallets",
    args: [],
  });
  return [...addresses];
}

export async function getInstructionFee(ctx: PublicFlareContext, encodedInstruction: string): Promise<number> {
  const instructionId = encodedInstruction.slice(0, 4);
  const instructionIdDecimal = fromHex(instructionId as `0x${string}`, "bigint");
  const requestFee = await ctx.publicClient.readContract({
    address: await getMasterAccountControllerAddress(ctx),
    abi:  iMasterAccountControllerAbi,
    functionName: "getInstructionFee",
    args: [instructionIdDecimal],
  });
  return dropsToXrp(Number(requestFee));
}

// --- UserOp encoding -------------------------------------------------------

function encodePackedUserOpData({
  customInstruction,
  sender,
  nonce,
}: {
  customInstruction: Call[];
  sender: Address;
  nonce: bigint;
}): `0x${string}` {
  const callData = encodeFunctionData({
    abi:  iPersonalAccountAbi,
    functionName: "executeUserOp",
    args: [customInstruction],
  });

  return encodeAbiParameters(
    [PACKED_USER_OPERATION_TUPLE],
    [
      {
        sender,
        nonce,
        initCode: "0x",
        callData,
        accountGasLimits: ZERO_BYTES32,
        preVerificationGas: 0n,
        gasFees: ZERO_BYTES32,
        paymasterAndData: "0x",
        signature: "0x",
      },
    ]
  );
}

/** Opcode 0xFE: 42-byte memo carrying keccak256 of the userOp; bytes go off-chain to the executor. */
export function encodeHashInstructionMemo({
  customInstruction,
  walletId,
  executorFeeUBA,
  sender,
  nonce,
}: {
  customInstruction: Call[];
  walletId: number;
  executorFeeUBA: bigint;
  sender: Address;
  nonce: bigint;
}): { memoData: `0x${string}`; data: `0x${string}` } {
  const data = encodePackedUserOpData({ customInstruction, sender, nonce });
  const memoData = concatHex([
    "0xFE",
    toHex(walletId, { size: 1 }),
    toHex(executorFeeUBA, { size: 8 }),
    keccak256(data),
  ]);
  return { memoData, data };
}

/** Opcode 0xFF: full ABI-encoded userOp in the memo (subject to XRPL 1024-byte cap). */
export function encodeExecuteUserOpMemo({
  customInstruction,
  walletId,
  executorFeeUBA,
  sender,
  nonce,
}: {
  customInstruction: Call[];
  walletId: number;
  executorFeeUBA: bigint;
  sender: Address;
  nonce: bigint;
}): `0x${string}` {
  const packedUserOperation = encodePackedUserOpData({ customInstruction, sender, nonce });
  return concatHex([
    "0xFF",
    toHex(walletId, { size: 1 }),
    toHex(executorFeeUBA, { size: 8 }),
    packedUserOperation,
  ]);
}

/** Opcode 0xE0: skip the memo of a target XRPL tx on its next direct mint (recovery). */
export function encodeSkipMemo({
  targetTxId,
  walletId = 0,
  executorFeeUBA = 0n,
}: {
  targetTxId: `0x${string}`;
  walletId?: number;
  executorFeeUBA?: bigint;
}): `0x${string}` {
  const normalizedTarget = padHex(normalizeXrplTransactionId(targetTxId), { size: 32 });
  return concatHex(["0xE0", toHex(walletId, { size: 1 }), toHex(executorFeeUBA, { size: 8 }), normalizedTarget]);
}

/** Opcode 0xE1: fast-forward the memo-instruction nonce (recovery). */
export function encodeFastForwardNonce({
  newNonce,
  walletId = 0,
  executorFeeUBA = 0n,
}: {
  newNonce: bigint;
  walletId?: number;
  executorFeeUBA?: bigint;
}): `0x${string}` {
  const paddedNonce = padHex(toHex(newNonce), { size: 32 });
  return concatHex(["0xE1", toHex(walletId, { size: 1 }), toHex(executorFeeUBA, { size: 8 }), paddedNonce]);
}

// --- User-side step --------------------------------------------------------

export type HashInstructionUserSide = {
  xrplTransactionHash: string;
  data: `0x${string}`;
  totalCallValue: bigint;
  nonce: bigint;
};

export async function sendXrplHashInstruction(
  ctx: PublicFlareContext,
  {
    customInstruction,
    amountXrp,
    personalAccount,
    xrplClient,
    xrplWallet,
    executorFeeUBA = 0n,
    walletId = 0,
  }: {
    customInstruction: Call[];
    amountXrp: number;
    personalAccount: Address;
    xrplClient: Client;
    xrplWallet: Wallet;
    executorFeeUBA?: bigint;
    walletId?: number;
  }
): Promise<HashInstructionUserSide> {
  const [nonce, coreVaultXrplAddress] = await Promise.all([
    getNonce(ctx, personalAccount),
    getDirectMintingPaymentAddress(ctx),
  ]);

  const { memoData, data } = encodeHashInstructionMemo({
    customInstruction,
    walletId,
    executorFeeUBA,
    sender: personalAccount,
    nonce,
  });
  const totalCallValue = customInstruction.reduce((acc, call) => acc + call.value, 0n);

  const transaction = await sendXrplPayment({
    destination: coreVaultXrplAddress,
    amount: amountXrp,
    memos: [{ Memo: { MemoData: memoData.slice(2) } }],
    wallet: xrplWallet,
    client: xrplClient,
  });

  return {
    xrplTransactionHash: transaction.result.hash,
    data,
    totalCallValue,
    nonce,
  };
}

// --- Executor-side step ----------------------------------------------------

export async function fetchXrpPaymentProof(
  ctx: FlareContext,
  {
    xrplTransactionHash,
    xrplClient,
  }: {
    xrplTransactionHash: string;
    xrplClient: Client;
  }
): Promise<IXrpPaymentProof> {
  const transactionId = normalizeXrplTransactionId(xrplTransactionHash);
  await waitForXrplFinality({ client: xrplClient, transactionHash: xrplTransactionHash });

  const { abiEncodedRequest } = await prepareXrpPaymentRequest(ctx, {
    transactionId,
    proofOwner: ctx.executorAccount.address,
  });
  const roundId = await submitAttestationRequest(ctx, abiEncodedRequest);
  return retrieveXrpPaymentProofWithRetry(ctx, abiEncodedRequest, roundId);
}

export async function executeDirectMintingWithData(
  ctx: FlareContext,
  {
    xrplTransactionHash,
    data,
    value,
    xrplClient,
    reuseExistingMint = false,
  }: {
    xrplTransactionHash: string;
    data: `0x${string}`;
    value: bigint;
    xrplClient: Client;
    reuseExistingMint?: boolean;
  }
): Promise<{ hash: `0x${string}`; receipt: TransactionReceipt }> {
  const transactionId = normalizeXrplTransactionId(xrplTransactionHash);
  const proof = await fetchXrpPaymentProof(ctx, { xrplTransactionHash, xrplClient });

  const assetManagerFxrpAddress = await getAssetManagerFXRPAddress(ctx);
  try {
    const callData = encodeFunctionData({
      abi: iDirectMintingAbi,
      functionName: "executeDirectMintingWithData",
      args: [proof, data],
    });
    const hash = await broadcastRaw(ctx, { to: assetManagerFxrpAddress, data: callData, value });
    const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") {
      if (!reuseExistingMint) {
        throw new Error(
          `executeDirectMintingWithData reverted (tx ${hash}). ` +
            "The XRPL payment may already be finalized on Flare — retry with reuseExistingMint."
        );
      }
      return { hash, receipt };
    }
    return { hash, receipt };
  } catch (error) {
    if (!reuseExistingMint || !isPaymentAlreadyConfirmedError(error)) {
      throw error;
    }
    const existingReceipt = await findDirectMintingReceiptForTransactionId(ctx, transactionId);
    return { hash: existingReceipt.transactionHash, receipt: existingReceipt };
  }
}

// --- Confirmation & diagnostics -------------------------------------------

export function findUserOperationExecuted(
  receipt: TransactionReceipt,
  personalAccount: Address,
  nonce: bigint
): UserOperationExecutedLog {
  const logs = parseEventLogs({
    abi:  iMemoInstructionsFacetAbi,
    eventName: "UserOperationExecuted",
    logs: receipt.logs,
  });
  for (const log of logs) {
    const args = log.args as unknown as { personalAccount: Address; nonce: bigint };
    if (
      args.personalAccount.toLowerCase() === personalAccount.toLowerCase() &&
      args.nonce === nonce
    ) {
      return { personalAccount: args.personalAccount, nonce: args.nonce };
    }
  }
  throw new Error(
    `UserOperationExecuted log not found on receipt ${receipt.transactionHash} for personalAccount=${personalAccount} nonce=${nonce}. ` +
      "The AssetManager may have delayed the minting (rate limit / large minting) — check for DirectMintingDelayed."
  );
}

export function assertNotDirectMintingDelayed(
  receipt: TransactionReceipt,
  label?: string
): void {
  const logs = parseEventLogs({
    abi:  iDirectMintingAbi,
    eventName: "DirectMintingDelayed",
    logs: receipt.logs,
  });
  if (logs.length === 0) {
    return;
  }
  const delayed = logs[0]!;
  const tag = label ? `[${label}] ` : "";
  throw new Error(
    `${tag}Direct minting was delayed (rate limit). ` +
      `executionAllowedAt=${delayed.args.executionAllowedAt}. ` +
      `Re-call with the same FDC proof after that timestamp. ` +
      `Do not send a second XRPL payment with the same nonce.`
  );
}

export async function findDirectMintingReceiptForTransactionId(
  ctx: PublicFlareContext,
  transactionId: `0x${string}`,
  maxBlocksToSearch: bigint = 10_000n
): Promise<TransactionReceipt> {
  const normalized = normalizeXrplTransactionId(transactionId);
  const assetManagerFxrpAddress = await getAssetManagerFXRPAddress(ctx);
  const latest = await ctx.publicClient.getBlockNumber();
  const earliest = latest > maxBlocksToSearch ? latest - maxBlocksToSearch : 0n;
  const RANGE = 29n;

  for (let toBlock = latest; toBlock >= earliest; toBlock -= RANGE + 1n) {
    const fromBlock = toBlock > RANGE ? toBlock - RANGE : earliest;
    const logs = await ctx.publicClient.getContractEvents({
      address: assetManagerFxrpAddress,
      abi:  iDirectMintingAbi,
      eventName: "DirectMintingExecutedToSmartAccount",
      args: { transactionId: normalized },
      fromBlock,
      toBlock,
    });
    if (logs.length > 0) {
      const mintLog = logs[logs.length - 1]!;
      return ctx.publicClient.getTransactionReceipt({ hash: mintLog.transactionHash });
    }
    if (fromBlock <= earliest) {
      break;
    }
  }

  throw new Error(
    `DirectMintingExecutedToSmartAccount not found for transactionId=${normalized} ` +
      `(searched the last ${maxBlocksToSearch} blocks)`
  );
}

export async function isStuckTransactionIdUsed(
  ctx: PublicFlareContext,
  targetTxId: `0x${string}`
): Promise<boolean> {
  const masterAccountControllerAddress = await getMasterAccountControllerAddress(ctx);
  return ctx.publicClient.readContract({
    address: masterAccountControllerAddress,
    abi:  iMemoInstructionsFacetAbi,
    functionName: "isTransactionIdUsed",
    args: [normalizeXrplTransactionId(targetTxId)],
  }) as Promise<boolean>;
}

export async function diagnoseStuckDirectMint(
  ctx: PublicFlareContext,
  {
    stuckXrplTxHash,
    personalAccount,
  }: {
    stuckXrplTxHash: string;
    personalAccount: Address;
  }
): Promise<{
  targetTxId: `0x${string}`;
  transactionIdUsed: boolean;
  nonce: bigint;
  pinnedExecutor: Address;
}> {
  const targetTxId = normalizeXrplTransactionId(stuckXrplTxHash);
  const [transactionIdUsed, nonce, pinnedExecutor] = await Promise.all([
    isStuckTransactionIdUsed(ctx, targetTxId),
    getNonce(ctx, personalAccount),
    getExecutor(ctx, personalAccount),
  ]);
  return { targetTxId, transactionIdUsed, nonce, pinnedExecutor };
}
