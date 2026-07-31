import { encodeFunctionData, erc20Abi, parseEventLogs, type Address } from "viem";
import { Client, Wallet } from "xrpl";
import { createFlareContext } from "../lib/flare/context";
import { getFxrpAddress } from "../lib/flare/contract-registry";
import {
  getPersonalAccountAddress,
  sendXrplHashInstruction,
  getBalances,
  type Call,
} from "../lib/flare/smart-accounts";
import { deliverUserOp, assertUserOpExecuted } from "../lib/executor/deliver";
import { computeDirectMintingPaymentAmountXrp, getFxrpBalance } from "../lib/flare/fassets";
import { getXrpBalance } from "../lib/flare/xrpl";

const VAULT = "0x040fee7daab727d6afb8efe6b770b15c0b2a89f6" as const;

const vaultAbi = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    type: "function",
    name: "redeem",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" },
    ],
    outputs: [{ name: "assets", type: "uint256" }],
  },
  {
    type: "function",
    name: "claimWithdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "period", type: "uint256" }],
    outputs: [{ name: "assets", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "WithdrawRequest",
    inputs: [
      { name: "caller", type: "address", indexed: true },
      { name: "receiver", type: "address", indexed: true },
      { name: "period", type: "uint256", indexed: false },
      { name: "assets", type: "uint256", indexed: false },
      { name: "shares", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "WithdrawalClaimed",
    inputs: [
      { name: "receiver", type: "address", indexed: true },
      { name: "period", type: "uint256", indexed: false },
      { name: "assets", type: "uint256", indexed: false },
    ],
  },
] as const;

const PERIOD_DURATION = 60;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const ctx = createFlareContext("coston2");
  const xrplClient = new Client(ctx.xrplRpcUrl);
  const xrplWallet = Wallet.fromSeed(process.env.XRPL_DEMO_SEED!);
  const personalAccount = await getPersonalAccountAddress(ctx, xrplWallet.address);
  const fxrpAddress = await getFxrpAddress(ctx);

  console.log("=== STEP 1: Deposit 3 FXRP into AutopilotVault (mint + deposit in one userOp) ===");
  const amountUBA = BigInt(3 * 1_000_000);
  const depositInstruction: Call[] = [
    { target: fxrpAddress, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [VAULT, amountUBA] }) },
    { target: VAULT, value: 0n, data: encodeFunctionData({ abi: vaultAbi, functionName: "deposit", args: [amountUBA, personalAccount] }) },
  ];
  const paymentAmountXrp = await computeDirectMintingPaymentAmountXrp(ctx, { netMintAmountXrp: 3 });
  const userSide = await sendXrplHashInstruction(ctx, {
    customInstruction: depositInstruction,
    amountXrp: paymentAmountXrp,
    personalAccount,
    xrplClient,
    xrplWallet,
  });
  const depositResult = await deliverUserOp(ctx, {
    xrplTransactionHash: userSide.xrplTransactionHash,
    data: userSide.data,
    totalCallValue: userSide.totalCallValue,
    personalAccount,
    xrplClient,
    expectNonce: userSide.nonce,
  });
  assertUserOpExecuted(depositResult, personalAccount);

  const sharesOf = await ctx.publicClient.readContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: "balanceOf",
    args: [personalAccount],
  });
  const vaultShares = sharesOf as bigint;
  console.log("Vault shares:", vaultShares.toString());

  console.log("\n=== STEP 2: Redeem all shares (user signs; executor drives) ===");
  const sharesToRedeem = vaultShares;
  const redeemInstruction: Call[] = [
    {
      target: VAULT,
      value: 0n,
      data: encodeFunctionData({ abi: vaultAbi, functionName: "redeem", args: [sharesToRedeem, personalAccount, personalAccount] }),
    },
  ];
  const redeemSide = await sendXrplHashInstruction(ctx, {
    customInstruction: redeemInstruction,
    amountXrp: await computeDirectMintingPaymentAmountXrp(ctx, { netMintAmountXrp: 0 }),
    personalAccount,
    xrplClient,
    xrplWallet,
  });
  const redeemResult = await deliverUserOp(ctx, {
    xrplTransactionHash: redeemSide.xrplTransactionHash,
    data: redeemSide.data,
    totalCallValue: redeemSide.totalCallValue,
    personalAccount,
    xrplClient,
    expectNonce: redeemSide.nonce,
  });
  assertUserOpExecuted(redeemResult, personalAccount);

  // Parse the WithdrawRequest event to find the redemption period (this is what the product automates)
  const withdrawLogs = parseEventLogs({ abi: vaultAbi, eventName: "WithdrawRequest", logs: redeemResult.receipt.logs });
  const wd = withdrawLogs.find(
    (l) => (l.args as { receiver: Address }).receiver.toLowerCase() === personalAccount.toLowerCase()
  );
  if (!wd) throw new Error("WithdrawRequest event not found");
  const period = (wd.args as { period: bigint }).period;
  const assetsPending = (wd.args as { assets: bigint }).assets;
  console.log("WithdrawRequest period:", period.toString(), "assets:", assetsPending.toString());

  // The claim becomes valid once the period has rolled (period < currentPeriod)
  const rollAt = Number(period + 1n) * PERIOD_DURATION * 1000;
  const waitMs = Math.max(0, rollAt - Date.now() + 16_000); // + lag buffer
  console.log(`Period rolls at epoch=${Number(period + 1n) * PERIOD_DURATION}; waiting ${Math.round(waitMs / 1000)}s...`);
  await sleep(waitMs);

  console.log("\n=== STEP 3: Executor auto-times the claim ===");
  const claimInstruction: Call[] = [
    {
      target: VAULT,
      value: 0n,
      data: encodeFunctionData({ abi: vaultAbi, functionName: "claimWithdraw", args: [period] }),
    },
  ];
  const claimSide = await sendXrplHashInstruction(ctx, {
    customInstruction: claimInstruction,
    amountXrp: await computeDirectMintingPaymentAmountXrp(ctx, { netMintAmountXrp: 0 }),
    personalAccount,
    xrplClient,
    xrplWallet,
  });
  const claimResult = await deliverUserOp(ctx, {
    xrplTransactionHash: claimSide.xrplTransactionHash,
    data: claimSide.data,
    totalCallValue: claimSide.totalCallValue,
    personalAccount,
    xrplClient,
    expectNonce: claimSide.nonce,
  });
  assertUserOpExecuted(claimResult, personalAccount);

  const claimedLogs = parseEventLogs({ abi: vaultAbi, eventName: "WithdrawalClaimed", logs: claimResult.receipt.logs });
  const claimed = claimedLogs.find(
    (l) => (l.args as { receiver: Address }).receiver.toLowerCase() === personalAccount.toLowerCase()
  );
  const claimedAssets = claimed ? (claimed.args as { assets: bigint }).assets : 0n;
  console.log("WithdrawalClaimed assets:", claimedAssets.toString());

  const fxrpAfter = await getFxrpBalance(ctx, personalAccount);
  console.log("\nFXRP in personal account after exit:", (Number(fxrpAfter) / 1e6).toFixed(2));
  const sharesAfter = (await ctx.publicClient.readContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: "balanceOf",
    args: [personalAccount],
  })) as bigint;
  console.log("Vault position now:", sharesAfter.toString());

  console.log("\nSUCCESS: Full exit lifecycle completed — redeem, period tracking, claim");
  await xrplClient.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
