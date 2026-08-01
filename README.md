# Autopilot — your XRP, on autopilot

**Flare Summer Signal · Bounty: Interoperable Asset Products**

---

## Project name

**Autopilot** — the lifecycle manager for XRP savings on Flare Smart Accounts.

## Bounty

**Bounty 1 — Interoperable Asset Products** ($6,000). The product is a consumer layer on
Flare's own interoperability stack (Flare Smart Accounts + FAssets + Flare Data Connector).

## Short product description

Depositing XRP into a Flare vault is one signature ("One Signature XRPFi", FSA v1.3). Exiting is
the hard part — redeem, find the redemption period, wait for it to roll, then claim, each step a
freshly signed XRPL payment. **Autopilot is the layer between "one signature in" and "one
signature out"**: it turns a user's outcome ("deposit", "exit") into the exact Flare Smart
Account steps, drives everything that doesn't need the user's key (attestation, delivery,
nonces, retries, period scheduling), and asks for a signature only when a signature is truly
required.

## Target user

Retail XRP holders using Flare Smart Accounts / FAssets to earn yield on their XRP — the exact
population FSA v1.3 is onboarding via Xaman, D'CENT, Joey, Ledger and Bifrost. They can deposit
in one signature today; they have no tooling for the second half of the journey.

---

## Demo

| | |
|---|---|
| **Working app** | Run locally: `cd app && pnpm i && cp .env.example .env.local && pnpm dev` → open http://localhost:3000 → **"Try the demo wallet"** |
| **Live network** | Flare **Coston2** testnet (chain id `114`) — all flows below are real, on-chain |
| **Proof** | Every flow has live tx hashes in [`LIVE_PROOF.md`](./LIVE_PROOF.md) |

**The demo in 60 seconds** (demo wallet + Autopilot demo vault are pre-configured):

1. Connect the demo wallet → see positions + risk cards.
2. **Deposit 2 XRP** → sign once → FXRP is minted and deposited atomically (`UserOperationExecuted` in one receipt).
3. **Exit** → sign once to burn shares → Autopilot reads the redemption `period` from the
   `WithdrawRequest` event and schedules the claim → when the period rolls, it promotes the step
   and pings you → sign once → FXRP is back.

### Why a demo vault?

Real Firelight / Upshift / Monarq vaults have redemption periods that last **days** — correct
for production, useless for a live demo. So Autopilot ships its own
[`AutopilotVault`](./contracts/src/AutopilotVault.sol) with **60-second periods**: the same
redemption-period contract logic (period → lag → claim), deployed on Coston2, so the full
deposit → period-roll → claim lifecycle can be watched on screen in two minutes. The engine
already reads positions from the **real registered vaults** (`getBalances`) and only swaps the
vault address to go live.

### Deployment

→ "Try the demo wallet" — same demo wallet, same live Coston2 state, dashboard-driven executor.
To host your own, see [`app/DEPLOY.md`](./app/DEPLOY.md).
---

## How Autopilot uses Flare (meaningfully, not superficially)

Every step is executed through Flare's native primitives:

| Flare primitive | Where Autopilot uses it |
|---|---|
| **Flare Smart Accounts** | Every action is a `0xFE` hash-memo **custom instruction** delivered to `MasterAccountController`, executed by the user's `PersonalAccount.executeUserOp` (EIP-4337-style batch). The 42-byte memo commits `keccak256(PackedUserOperation)` — only the user's XRPL key can authorize a step. |
| **FAssets (FXRP)** | Minting via `AssetManagerFXRP.executeDirectMintingWithData`; positions via `IReaderFacet.getBalances`. Deposit = mint + approve + deposit in one atomic userOp. |
| **Flare Data Connector** | A fresh `XRPPayment` attestation proves every XRPL payment before delivery; the executor handles `DirectMintingDelayed` retries with the same proof and `PaymentAlreadyConfirmed` recovery. |
| **PersonalAccount determinism** | The user's smart account is resolved from any XRPL address (`getPersonalAccount`) — no new wallet, no gas token, no bridge. |

The executor is **non-custodial by construction**: it never holds user keys or funds, and the
on-chain `keccak256` commitment check means it cannot substitute bytes or trigger a userOp the
user did not sign.

---

## What was newly built during the program

1. **`AutopilotVault`** (Foundry, 8 passing tests) — a Firelight-style redemption-period savings
   vault deployed on Coston2 with 60-second periods, so the full deposit → period → claim
   lifecycle can be exercised and judged live.
2. **Flare library** (`app/lib/flare/`) — dependency-injected adapters over Flare Smart
   Accounts, FAssets and FDC (viem), including a nonce tracker and raw-broadcast layer that
   handles Coston2's RPC quirks (500 gwei minimum fee, Avalanche C-chain nonce lag).
3. **Intent engine** (`app/lib/intent/`) — decomposes user outcomes into exact userOp steps with
   auto-scheduled triggers; prepares the 42-byte `0xFE` memo, XRPL payment amount and executor bytes.
4. **Executor service** (`app/lib/executor/`) — non-custodial delivery engine: FDC attestation,
   `executeDirectMintingWithData`, nonce management, `DirectMintingDelayed` retry,
   `PaymentAlreadyConfirmed` recovery, and period/claim scheduling (with an in-flight step guard).
5. **Consumer app** — Next.js dashboard: connect, live positions, risk cards, deposit/exit
   intents, and an "Autopilot" inbox that requests a signature only when one is needed.

## Smart contracts & deployment details

Network: **Coston2 testnet** (chain id `114`).

| Contract | Address | Deploy tx |
|---|---|---|
| `AutopilotVault` (60s periods, FXRP asset) | `0x040fee7daab727d6afb8efe6b770b15c0b2a89f6` | `0x2707aa6671c9dabe3e834ad8d8b6cd256c1ec03066b542ab42ccc3af20b17dde` |

Flare system contracts (resolved via `FlareContractRegistry`):
`MasterAccountController` `0x434936d47503353f06750Db1A444DBDC5F0AD37c` · `AssetManagerFXRP`
`0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA` · FXRP `0x0b6A3645c240605887a5532109323A3E12273dc7`.

Executor (fee-only, funded): `0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf`.
Demo user (XRPL testnet): `raBXKgiRor958xVko9mgb3AnnwRNbWNVfv` →
personal account `0x6e2b0AcC221F2B59Fb6c7dA6dEf689bFEBC2e534`.

---

## Architecture

```
                          ┌──────────────────────────────────────────────┐
                          │                USER (retail XRP holder)      │
                          │   Xaman / D'CENT / Joey / any XRPL wallet    │
                          └───────────────────┬──────────────────────────┘
                                              │  one XRPL Payment, 42-byte 0xFE
                                              │  hash-memo  =  keccak256(userOp)
                                              ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                            AUTOPILOT (non-custodial)                          │
│  Intent engine ──▶ userOp steps + schedule    ──▶  Executor service          │
│  (outcome → steps, auto-timed triggers)          (deliver, nonce-track, retry)│
│  MCP endpoint (AI agent access)               ──▶  FDC attestation request    │
└──────────────────────────────┬────────────────────────────────────────────────┘
                               │  deliver via FDC
                               ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                           FLARE (Coston2 / mainnet)                           │
│  Flare Data Connector: XRPPayment attestation proof                           │
│  MasterAccountController ──▶ PersonalAccount.executeUserOp (FSA v1.3)         
│  AssetManagerFXRP: executeDirectMintingWithData  →  FXRP                      │
│  AutopilotVault / Firelight / Upshift vaults: deposit → period → claim        │
└───────────────────────────────────────────────────────────────────────────────┘
```

```
app/                      Next.js app (UI + API routes)
  api/connect             resolve personal account for an XRPL address
  api/positions           live positions across vaults (incl. demo vault)
  api/vaults              vault catalog with risk profiles
  api/intents             create/list deposit & exit intents
  api/intents/:id/sign    record a user signature (or demo-sign)
  api/executor/tick       dashboard-driven executor: promote + deliver steps
  api/mcp                 Model Context Protocol endpoint (JSON-RPC 2.0)
  mcp                     interactive MCP test page
lib/flare/                DI adapters over FSA, FAssets, FDC (viem)
lib/intent/               intent → step decomposition, userOp preparation
lib/executor/             delivery engine (nonce tracking, retries, scheduling)
lib/mcp/                  MCP tools + JSON-RPC server
lib/store.ts              BigInt-safe persistence (fs / volume-backed)
contracts/                Foundry: AutopilotVault + tests
scripts/                  deploy, probe, executor round-trip, exit lifecycle
```

## Agentic access — Autopilot MCP

The same engine is exposed as a **Model Context Protocol** endpoint (`POST /api/mcp`), so an
AI agent can manage a user's XRP savings on Flare: `get_positions`, `get_vaults`,
`create_deposit`, `create_exit`, `sign_step`, `run_executor`, `get_intents`. Try it interactively
at `/mcp`, or wire it into Claude Desktop / Cursor:

```json
{ "mcpServers": { "autopilot": { "type": "http", "url": "http://localhost:3000/api/mcp" } } }
```

## Setup & how to test locally

The Next.js app lives in **`app/`**, so its env files live there too (`app/.env.example`,
`app/.env.local`) — this is standard Next.js: `next dev` loads `.env.local` from the app's own
directory, never from the repo root.

**The env files are pre-filled with the exact live-tested Coston2 values** (see `LIVE_PROOF.md`);
nothing to fill in. To verify on your machine:

```bash
cd app
cp .env.example .env.local   # ready values — just copy, no edits needed
pnpm install
pnpm dev                     # open http://localhost:3000 → "Try the demo wallet"
```

Ready values that are already baked in (all confirmed live on Coston2):

| Value | What it is |
|---|---|
| `EXECUTOR_PRIVATE_KEY=0x0000…0001` | Coston2 test key → executor `0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf` (funded, 85+ C2FLR) |
| `XRPL_DEMO_SEED=sEd7WWqd…` → `raBXKgiRor958xVko9mgb3AnnwRNbWNVfv` | funded XRPL testnet demo wallet (97+ XRP) |
| `NEXT_PUBLIC_DEMO_XRPL=raBXKgi…` | the wallet the "Try the demo wallet" button connects |
| `VERIFIER_API_KEY_TESTNET=00000000-…` | Flare's public FDC verifier API key (shared by all testnet devs) |

Clean slate before a demo (optional):

```bash
rm -rf app/.data      # wipes recorded intents for a fresh start
```

Verify on-chain (needs C2FLR on the executor + XRP on the demo wallet — both already funded):

```bash
pnpm tsx --env-file=.env.local scripts/executor-roundtrip.ts   # mint + deposit proof-of-life
pnpm tsx --env-file=.env.local scripts/exit-lifecycle.ts       # redeem → period → claim
cd ../contracts && forge test                                  # 8 passing tests
```

---

## Roadmap / next steps

- **Mainnet** readiness with real Firelight / Clearstar / Monarq vaults (positions already read
  via `getBalances`); a self-sustaining executor fee model.
- **Recovery UI**: guided `0xE0` skip-memo / `0xE1` nonce recovery for stuck payments.
- **Compound intent** and **cap alerts** so users capture vault cap openings automatically.
- **Wallet distribution**: Joey in-wallet dApp, Xaman xApp, D'CENT integration.

## Traction signals (honest)

- All core flows validated **live on Coston2** with public tx hashes (`LIVE_PROOF.md`).
- Built in one week during the hackathon; demo is reproducible from `.env.example`.
- Early feedback channel: Flare hackathon Telegram (see submission for links).

## Security posture

Non-custodial end-to-end: the user's XRPL key authorizes every step; the executor delivers only
the user-committed bytes and holds no user funds. Executor key is server-side only. Steps are
validated before delivery; broadcasts use explicit gas/fees and a serialized nonce tracker.

## Trust assumptions (explicit)

- **The user's XRPL key** is the root of authority. Every step is a `0xFE` hash-memo payment
  committing `keccak256(PackedUserOperation)`; the personal account enforces this on-chain, so
  the executor cannot substitute bytes or trigger a userOp the user did not sign.
- **The executor** is trusted only to *deliver* faithfully — it is fee-only, never holds user
  funds or keys, and runs with a server-side key. It cannot move assets on its own.
- **The Flare Data Connector** is relied on as the oracle for `XRPPayment` attestations, per
  FSA's own trust model.
- **Not in scope for this demo:** the demo vault is testnet (60s periods); mainnet vault logic is
  unchanged but audited separately before funds are involved.
