import { encodeFunctionData, erc20Abi } from "viem";
import { Client, Wallet } from "xrpl";
import { createFlareContext } from "../lib/flare/context";
import { getFxrpAddress } from "../lib/flare/contract-registry";
import {
  getPersonalAccountAddress,
  getVaults,
  sendXrplHashInstruction,
  executeDirectMintingWithData,
  findUserOperationExecuted,
  getBalances,
  type Call,
} from "../lib/flare/smart-accounts";
import { computeDirectMintingPaymentAmountXrp, getFxrpBalance } from "../lib/flare/fassets";
import { getXrpBalance } from "../lib/flare/xrpl";

// Minimal ERC4626-compatible vault ABI (Firelight-style).
const vaultAbi = [
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
] as const;

/**
 * Full proof-of-life round trip on Coston2:
 *   1. Send an XRPL Payment carrying a 0xFE hash memo (mints FXRP to the personal account)
 *   2. Executor fetches the FDC XRPPayment proof and calls
 *      AssetManagerFXRP.executeDirectMintingWithData(proof, userOp)
 *   3. The userOp atomically approves + deposits the freshly minted FXRP
 *      into the first registered Firelight vault
 *   4. Verify the personal account's vault position via getBalances
 */
async function main() {
  const network = "coston2";
  const ctx = createFlareContext(network);
  const xrplClient = new Client(ctx.xrplRpcUrl);
  const seed = process.env.XRPL_DEMO_SEED;
  if (!seed) throw new Error("XRPL_DEMO_SEED missing in .env.local");
  const xrplWallet = Wallet.fromSeed(seed);

  console.log("XRPL wallet:", xrplWallet.address);

  const personalAccount = await getPersonalAccountAddress(ctx, xrplWallet.address);
  console.log("Personal account:", personalAccount);

  const fxrpAddress = await getFxrpAddress(ctx);
  const vaults = await getVaults(ctx);
  const firelight = vaults.find((v) => v.type === 1);
  if (!firelight) throw new Error("No Firelight vault (type 1) registered on Coston2");
  console.log(`Target vault: Firelight vaultId=${firelight.id} ${firelight.address}`);

  // Mint 5 FXRP and deposit all of it into the vault in one userOp.
  const mintAmountXrp = 5;
  const depositUBA = BigInt(5 * 1_000_000); // 5 FXRP, 6 decimals

  const paymentAmountXrp = await computeDirectMintingPaymentAmountXrp(ctx, { netMintAmountXrp: mintAmountXrp });
  const xrpBalance = await getXrpBalance(xrplWallet.address, xrplClient);
  console.log(`Payment amount needed: ${paymentAmountXrp} XRP; wallet has ${xrpBalance} XRP`);
  if (xrpBalance < paymentAmountXrp) throw new Error("Insufficient XRP on demo wallet");

  const customInstruction: Call[] = [
    {
      target: fxrpAddress,
      value: 0n,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [firelight.address, depositUBA],
      }),
    },
    {
      target: firelight.address,
      value: 0n,
      data: encodeFunctionData({
        abi: vaultAbi,
        functionName: "deposit",
        args: [depositUBA, personalAccount],
      }),
    },
  ];

  console.log("\n--- Step 1: user signs XRPL payment (0xFE hash memo) ---");
  const userSide = await sendXrplHashInstruction(ctx, {
    customInstruction,
    amountXrp: paymentAmountXrp,
    personalAccount,
    xrplClient,
    xrplWallet,
  });
  console.log("XRPL tx:", userSide.xrplTransactionHash);

  console.log("\n--- Step 2: executor finalizes mint + userOp ---");
  const { receipt, hash } = await executeDirectMintingWithData(ctx, {
    xrplTransactionHash: userSide.xrplTransactionHash,
    data: userSide.data,
    value: userSide.totalCallValue,
    xrplClient,
  });
  console.log("Executor tx:", hash);

  console.log("\n--- Step 3: confirm userOp executed ---");
  const event = findUserOperationExecuted(receipt, personalAccount, userSide.nonce);
  console.log("UserOperationExecuted nonce:", event.nonce.toString());

  console.log("\n--- Step 4: verify position ---");
  const balances = await getBalances(ctx, xrplWallet.address);
  console.log("FXRP balance (personal account):", (await getFxrpBalance(ctx, personalAccount)).toString(), "UBA");
  for (const v of balances.vaults) {
    console.log(`  vaultId=${v.vaultId} type=${v.vaultType} shares=${v.shares} assets=${v.assets}`);
  }

  console.log("\nSUCCESS: FXRP minted and deposited into Firelight vault on Coston2");
  await xrplClient.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
