# Autopilot — your XRP, on autopilot

**The lifecycle manager for XRP savings on Flare.**

Depositing XRP into a Flare vault is one signature. Exiting is the hard part: redeem, then find
the redemption period, wait for it to roll, then claim — with nonce collisions, stuck mints and
delayed finality lurking at every step. Autopilot is the layer between "one signature in" and
"one signature out": it decomposes your outcome into the exact Flare Smart Account steps, drives
everything that doesn't need your key, and asks you to sign only when a signature is genuinely
required.

Built for the **Flare Summer Signal** hackathon (Interoperable Asset Products bounty).

---

## The problem

Flare Smart Accounts made XRPfi **deposits** one signature ("One Signature XRPFi", FSA v1.3).
But the *rest* of the journey is still manual and hostile to retail users:

- **Multi-step exits.** Firelight: `redeem` → wait a period → `claimWithdraw(period)`. Upshift:
  `requestRedeem` → wait an epoch → `claim(year, month, day)`. Each step is a separate signed
  XRPL payment; the claim's `period` is only discoverable by parsing events.
- **Miss the window, funds sit in limbo.** Claims are only valid after the period rolls and lag
  elapses.
- **Documented failure modes.** Nonce collisions, `DirectMintingDelayed` rate limits, stuck
  payments at the Core Vault, `InvalidNonce` from duplicate payments — all fully documented by
  Flare, none handled by the consumer.
- **Risk blindness.** Vaults have different strategies, lockups, slashing exposure and caps that
  fill up. Nobody explains the second half of the journey.

## The product

| Capability | What it does |
|---|---|
| **Connect** | Paste any XRPL address; your Flare Smart Account is resolved automatically. No new wallet, no gas token, no bridge. |
| **Positions** | Live view of FXRP and per-vault positions (shares + assets) straight from the chain, with plain-English risk cards per vault. |
| **Deposit intent** | One signature mints FXRP **and** deposits it atomically (approve + deposit in one userOp). |
| **Exit intent** | Two signatures, auto-timed: burn shares now, then Autopilot computes the exact redemption `period`, waits for it to roll, and pings you to sign the claim. |
| **Executor service** | Non-custodial delivery of `0xFE` custom instructions: FDC attestation, `executeDirectMintingWithData`, nonce management, `DirectMintingDelayed` retry, `PaymentAlreadyConfirmed` recovery. |
| **Inbox** | "What happened, what's next, what needs your signature and why." |

## Architecture

```
app/                    Next.js app (UI + API routes)
  api/connect           resolve personal account for an XRPL address
  api/positions         live positions across vaults (incl. demo vault)
  api/vaults            vault catalog with risk profiles
  api/intents           create/list deposit & exit intents
  api/intents/:id/sign  record a user signature (or demo-sign)
  api/executor/tick     cron-driven executor: promote + deliver steps
lib/flare/              DI adapters over FSA, FAssets, FDC (viem)
lib/intent/             intent → step decomposition, userOp preparation
lib/executor/           delivery engine (nonce tracking, retries, scheduling)
lib/store.ts            BigInt-safe persistence (fs / Postgres-ready)
contracts/              Foundry: AutopilotVault + tests
scripts/                deploy, probe, executor round-trip, exit lifecycle
```

## How the executor stays non-custodial

The user's XRPL key authorizes every userOp: each step is an XRPL Payment whose 42-byte `0xFE`
memo commits to `keccak256(PackedUserOperation)`. The executor only (a) reads the FDC
`XRPPayment` attestation and (b) calls `AssetManagerFXRP.executeDirectMintingWithData(proof, bytes)`.
The on-chain hash check means the executor **cannot** substitute different bytes or trigger a
userOp the user didn't sign. Executor keys never touch user funds.

## Setup

```bash
cp .env.example .env.local
# fund the executor key (EXECUTOR_PRIVATE_KEY) with C2FLR via the Coston2 faucet
# fund an XRPL testnet wallet; set XRPL_DEMO_SEED / XRPL_DEMO_ADDRESS / NEXT_PUBLIC_DEMO_XRPL
pnpm install
pnpm dev            # http://localhost:3000
```

Contracts:

```bash
cd contracts && forge test          # 8 passing tests
cd ../app && pnpm tsx --env-file=.env.local scripts/deploy-vault.ts
```

Verify live:

```bash
pnpm tsx --env-file=.env.local scripts/executor-roundtrip.ts   # mint + deposit proof-of-life
pnpm tsx --env-file=.env.local scripts/exit-lifecycle.ts       # redeem → period → claim
```

## Evidence

See [LIVE_PROOF.md](./LIVE_PROOF.md) — every flow above has live Coston2 tx hashes.
