import type { FlareContext } from "../flare/context";
import { getServerPublicContext, getServerContext } from "../server/context";
import { getPersonalAccountAddress, getBalances } from "../flare/smart-accounts";
import { getFxrpBalance } from "../flare/fassets";
import { getVaultProfile, formatXrp, AUTOPILOT_VAULT_ADDRESS, firelightVaultAbi, COSTON2_VAULTS } from "../flare/vaults";
import { getXrpBalance } from "../flare/xrpl";
import { buildDepositIntent, buildExitIntent } from "../intent/engine";
import { saveIntent, getIntent, listIntentsByXrpl, listActiveIntents } from "../store";
import { tickExecutor } from "../executor/scheduler";

const TOOL_VAULT_CACHE = COSTON2_VAULTS.map((v) => ({
  id: v.id.toString(),
  address: v.address,
  type: v.type,
  name: v.name,
  operator: v.operator,
  strategy: v.strategy,
  lockup: v.lockup,
  riskLevel: v.riskLevel,
  riskNotes: v.riskNotes,
  capXrp: v.capUBA !== null ? formatXrp(v.capUBA) : null,
  deployed: v.deployed ?? false,
}));

export type McpTool = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
};

export type McpCallResult = { isError: boolean; content: { type: "text"; text: string }[] };

export const TOOLS: McpTool[] = [
  {
    name: "get_positions",
    description:
      "Get a user's XRP savings positions on Flare: FXRP balance, per-vault shares/assets, risk profile, and their on-ledger XRP.",
    inputSchema: {
      type: "object",
      properties: { xrpl: { type: "string", description: "XRPL address (r...) of the user" } },
      required: ["xrpl"],
    },
  },
  {
    name: "get_vaults",
    description: "List the available XRP yield vaults on Flare with their strategy and risk level.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_deposit",
    description:
      "Create a one-signature deposit intent: mints FXRP from the user's XRP and deposits it into a vault atomically. Returns the exact XRPL payment to sign.",
    inputSchema: {
      type: "object",
      properties: {
        xrpl: { type: "string", description: "XRPL address (r...) of the user" },
        vaultAddress: { type: "string", description: "0x vault address from get_vaults" },
        amountXrp: { type: "string", description: "Amount of XRP to deposit" },
      },
      required: ["xrpl", "vaultAddress", "amountXrp"],
    },
  },
  {
    name: "create_exit",
    description:
      "Create an auto-timed exit intent for a vault position. Two signatures: burn shares now, then Autopilot schedules the claim after the redemption period rolls.",
    inputSchema: {
      type: "object",
      properties: {
        xrpl: { type: "string", description: "XRPL address (r...) of the user" },
        vaultAddress: { type: "string", description: "0x vault address" },
        sharesUba: { type: "string", description: "Vault shares to exit (in base units, 6 decimals for FXRP)" },
      },
      required: ["xrpl", "vaultAddress", "sharesUba"],
    },
  },
  {
    name: "sign_step",
    description:
      "Record a user's signature for a pending step. Pass the XRPL tx hash the user signed in their own wallet, or demoSign:true when the intent belongs to the demo wallet.",
    inputSchema: {
      type: "object",
      properties: {
        intentId: { type: "string", description: "Intent id from create_deposit/create_exit" },
        xrplTxHash: { type: "string", description: "XRPL tx hash the user signed (own wallet)" },
        demoSign: { type: "boolean", description: "Sign with the pre-funded demo wallet (demo address only)" },
      },
      required: ["intentId"],
    },
  },
  {
    name: "run_executor",
    description:
      "Advance the executor one step for a user: promote timed claim steps and deliver any signed step (FDC attestation, nonce handling, retries).",
    inputSchema: {
      type: "object",
      properties: { xrpl: { type: "string", description: "Optional — restrict to one XRPL address" } },
    },
  },
  {
    name: "get_intents",
    description: "List a user's deposit/exit intents and their step statuses.",
    inputSchema: {
      type: "object",
      properties: { xrpl: { type: "string", description: "XRPL address (r...)" } },
      required: ["xrpl"],
    },
  },
];

function text(data: unknown): McpCallResult {
  return { isError: false, content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function error(msg: string): McpCallResult {
  return { isError: true, content: [{ type: "text", text: msg }] };
}

async function getDemoVaultPosition(ctx: ReturnType<typeof getServerPublicContext>, personalAccount: `0x${string}`) {
  try {
    const shares = (await ctx.publicClient.readContract({
      address: AUTOPILOT_VAULT_ADDRESS,
      abi: firelightVaultAbi,
      functionName: "balanceOf",
      args: [personalAccount],
    })) as bigint;
    const assets = (await ctx.publicClient.readContract({
      address: AUTOPILOT_VAULT_ADDRESS,
      abi: firelightVaultAbi,
      functionName: "convertToAssets",
      args: [shares],
    })) as bigint;
    const p = getVaultProfile(AUTOPILOT_VAULT_ADDRESS)!;
    return {
      vaultId: p.id.toString(),
      vaultAddress: AUTOPILOT_VAULT_ADDRESS,
      name: p.name,
      type: p.type,
      riskLevel: p.riskLevel,
      strategy: p.strategy,
      shares: shares.toString(),
      assets: assets.toString(),
      assetsXrp: formatXrp(assets),
    };
  } catch {
    return null;
  }
}

const tools: Record<string, (ctx: FlareContext, args: Record<string, unknown>) => Promise<McpCallResult>> = {
  async get_positions(ctx, args) {
    const xrpl = String(args.xrpl ?? "");
    if (!xrpl) return error("Missing xrpl");
    const pub = getServerPublicContext();
    const personalAccount = await getPersonalAccountAddress(pub, xrpl);
    const [balances, fxrpUba, xrpBalance] = await Promise.all([
      getBalances(pub, xrpl),
      getFxrpBalance(pub, personalAccount),
      getXrpBalance(xrpl).catch(() => 0),
    ]);
    const vaults = balances.vaults
      .filter((v) => v.shares > 0n)
      .map((v) => {
        const p = getVaultProfile(v.vaultAddress);
        return {
          vaultId: v.vaultId.toString(),
          vaultAddress: v.vaultAddress,
          name: p?.name ?? "Unknown vault",
          type: p?.type ?? "unknown",
          riskLevel: p?.riskLevel ?? "unknown",
          strategy: p?.strategy ?? "",
          shares: v.shares.toString(),
          assets: v.assets.toString(),
          assetsXrp: formatXrp(v.assets),
        };
      });
    const demo = await getDemoVaultPosition(pub, personalAccount);
    if (demo && BigInt(demo.shares) > 0n) vaults.push(demo);
    return text({
      xrpl,
      personalAccount,
      xrpBalanceXrp: xrpBalance.toFixed(2),
      fxrpXrp: formatXrp(fxrpUba),
      natUba: balances.natBalance.toString(),
      vaults,
    });
  },

  async get_vaults() {
    return text({
      vaults: getVaultProfiles(),
    });
  },

  async create_deposit(ctx, args) {
    const { xrpl, vaultAddress, amountXrp } = args as Record<string, string>;
    if (!xrpl || !vaultAddress || !amountXrp) return error("Missing xrpl/vaultAddress/amountXrp");
    const vault = getVaultProfile(vaultAddress as `0x${string}`);
    if (!vault) return error("Unknown vault address");
    const pub = getServerPublicContext();
    const personalAccount = await getPersonalAccountAddress(pub, xrpl);
    const intent = await buildDepositIntent(pub, {
      xrplAddress: xrpl,
      personalAccount,
      vault,
      amountUBA: BigInt(Math.round(Number(amountXrp) * 1_000_000)),
    });
    await saveIntent(intent);
    const step = intent.steps[0];
    return text({
      intentId: intent.id,
      status: intent.status,
      nextStep: step
        ? {
            label: step.label,
            destination: step.userOp?.destination,
            amountXrp: step.userOp?.paymentAmountXrp.toFixed(2),
            memo: step.userOp?.memo,
          }
        : null,
    });
  },

  async create_exit(ctx, args) {
    const { xrpl, vaultAddress, sharesUba } = args as Record<string, string>;
    if (!xrpl || !vaultAddress || !sharesUba) return error("Missing xrpl/vaultAddress/sharesUba");
    const vault = getVaultProfile(vaultAddress as `0x${string}`);
    if (!vault) return error("Unknown vault address");
    const pub = getServerPublicContext();
    const personalAccount = await getPersonalAccountAddress(pub, xrpl);
    const shares = BigInt(sharesUba);
    if (shares <= 0n) return error("sharesUba must be > 0");
    const intent = await buildExitIntent(pub, { xrplAddress: xrpl, personalAccount, vault, shares });
    await saveIntent(intent);
    return text({
      intentId: intent.id,
      status: intent.status,
      steps: intent.steps.map((s) => ({ order: s.order, label: s.label, status: s.status })),
    });
  },

  async sign_step(ctx, args) {
    const { intentId, xrplTxHash, demoSign } = args as Record<string, unknown>;
    const intent = await getIntent(String(intentId ?? ""));
    if (!intent) return error("Intent not found");
    const step = intent.steps.find((s) => s.status === "pending_sign");
    if (!step) return error("No step awaiting signature");
    if (!step.userOp) return error("Step has no prepared userOp");

    let hash = String(xrplTxHash ?? "");
    if (demoSign === true) {
      const demoAddress = process.env.XRPL_DEMO_ADDRESS ?? "";
      if (intent.xrplAddress.toLowerCase() !== demoAddress.toLowerCase()) {
        return error("demoSign only works for the demo wallet — pass xrplTxHash instead");
      }
      const { Wallet, Client } = await import("xrpl");
      const { sendXrplPayment } = await import("../flare/xrpl");
      const seed = process.env.XRPL_DEMO_SEED;
      if (!seed) return error("Demo signing not configured");
      const client = new Client(ctx.xrplRpcUrl);
      const tx = await sendXrplPayment({
        destination: step.userOp.destination,
        amount: step.userOp.paymentAmountXrp,
        memos: [{ Memo: { MemoData: step.userOp.memo.slice(2) } }],
        wallet: Wallet.fromSeed(seed),
        client,
      });
      hash = tx.result.hash;
    }
    if (!hash) return error("Provide xrplTxHash or demoSign");

    const steps = intent.steps.map((s) =>
      s.id === step.id ? { ...s, status: "signed" as const, xrplTxHash: hash, updatedAt: Date.now() } : s
    );
    await saveIntent({ ...intent, steps, updatedAt: Date.now() });
    return text({ intentId: intent.id, stepStatus: "signed", xrplTxHash: hash });
  },

  async run_executor(ctx, args) {
    const xrpl = args.xrpl ? String(args.xrpl) : undefined;
    const report = await tickExecutor(
      ctx,
      { loadActive: listActiveIntents, save: saveIntent },
      xrpl
    );
    return text(report);
  },

  async get_intents(ctx, args) {
    const xrpl = String(args.xrpl ?? "");
    if (!xrpl) return error("Missing xrpl");
    const intents = await listIntentsByXrpl(xrpl);
    return text({
      intents: intents.map((i) => ({
        id: i.id,
        kind: i.kind,
        status: i.status,
        amountUba: i.amountUBA.toString(),
        steps: i.steps.map((s) => ({
          order: s.order,
          label: s.label,
          status: s.status,
          triggerAt: s.triggerAt ?? undefined,
          xrplTxHash: s.xrplTxHash,
          flareTxHash: s.flareTxHash,
          error: s.error,
        })),
      })),
    });
  },
};

export function getVaultProfiles() {
  return TOOL_VAULT_CACHE;
}

export async function callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
  const fn = tools[name];
  if (!fn) return error(`Unknown tool: ${name}`);
  try {
    const ctx = getServerContext();
    return await fn(ctx, args);
  } catch (e) {
    return error(`Tool failed: ${(e as Error).message}`);
  }
}
