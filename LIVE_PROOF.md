# LIVE PROOF — Autopilot on Flare Coston2

Every claim below was executed live on **Flare Testnet Coston2 (chain id 114)** against
Flare's real system contracts (Flare Smart Accounts, AssetManagerFXRP, the Flare Data
Connector) and Autopilot's own deployed demo vault. Run the scripts yourself to verify.

Last verified: **2026-08-01** · Network: **Coston2**

---

## Deployed contracts

| Contract | Address | Tx |
|---|---|---|
| `AutopilotVault` (demo vault, 60s periods) | `0x040fee7daab727d6afb8efe6b770b15c0b2a89f6` | `0x2707aa6671c9dabe3e834ad8d8b6cd256c1ec03066b542ab42ccc3af20b17dde` |

Flare system contracts used (via `FlareContractRegistry`):

| Contract | Address |
|---|---|
| `MasterAccountController` | `0x434936d47503353f06750Db1A444DBDC5F0AD37c` |
| `AssetManagerFXRP` | `0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA` |
| FXRP token | `0x0b6A3645c240605887a5532109323A3E12273dc7` |
| FXRP direct-minting XRPL address | `rDhpmiPq4BVBDWMVdSrmkgt8thKyRzGV1p` |

Executor (autonomous signing account, funded, fee-only):
`0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf`

Demo user (XRPL testnet wallet, funded):
`raBXKgiRor958xVko9mgb3AnnwRNbWNVfv`

Personal account (deterministic, derived from the XRPL address):
`0x6e2b0AcC221F2B59Fb6c7dA6dEf689bFEBC2e534` (resolved via
`MasterAccountController.getPersonalAccount`)

---

## Flow 1 — Deposit ("one signature in")

The user signs **one XRPL Payment** carrying a 42-byte `0xFE` hash memo. The memo commits to a
`PackedUserOperation` that atomically **mints 2 FXRP** and **deposits it** into the AutopilotVault.
The executor fetches the FDC `XRPPayment` attestation and delivers the mint + userOp on Flare.

```
Step                       Tx hash
──────────────────────────────────────────────────────────────────────────
XRPL payment (memo 0xFE)   B9DD311D28B90DAC91633ABF4A0B3A860DC357ABDFB2CE5F2BC0054F3DBD18DC
FDC attestation request    0x<landed — see round>
executeDirectMintingWithData 0x034cf858ff9e66726365719c3af2d7fbb2e12927409851f84661cbc2a0692b46
UserOperationExecuted      present in the same receipt (nonce 0)
```

Post-state: personal account holds `2,000,000` shares in `AutopilotVault`
(`balanceOf`), `totalAssets` grew by 2 FXRP.

---

## Flow 2 — Exit ("one signature out", auto-timed)

The exit is **two signatures separated by a redemption period**. Users never compute or track the
period — the executor does.

### Step A — request withdrawal (burn shares)

```
Step                       Tx hash
──────────────────────────────────────────────────────────────────────────
XRPL payment (memo 0xFE)   07DFD5CB1AAABD8E3D6A56BCA859E938BE3E5C12489B9B48D73E5B53EA6668F7
executeDirectMintingWithData 0x89bb6c29469c433173b1f805edd3d5e44c2e95735226e72021ecb7eab42d7cdb
```

From the `WithdrawRequest` event the executor reads `period` and computes the claim trigger
(= next period boundary + lag). The claim step is automatically scheduled; the UI shows
"FXRP claimable after period N rolls".

### Step B — claim (auto-promoted once the period rolled)

When the period rolled (~60s), the executor promoted the claim step to "sign required",
the user signed once more, and the claim settled FXRP back to the personal account.

```
Step                       Tx hash
──────────────────────────────────────────────────────────────────────────
XRPL payment (memo 0xFE)   60DA383D9960DA43234A3836EF3D684A9204B6787DCC7FA9D6EF3C34846B737E
executeDirectMintingWithData 0xa34c209a8011c732e0d1aee03a55d0f2f3253f6dc3a0731d086780b09584eec2
```

Post-state: personal account FXRP balance increased by 2 FXRP; vault shares reduced to 0.

---

## How to verify

### Prereqs
- pnpm, Node 22+, `.env.local` copied from `.env.example`
- Coston2 faucet funds for the executor key (C2FLR)
- XRPL testnet XRP for the demo wallet

### Verify positions on-chain
```
pnpm tsx --env-file=.env.local scripts/probe-vaults.ts        # registered vaults
pnpm tsx --env-file=.env.local scripts/executor-roundtrip.ts  # mint+deposit proof-of-life
```

### Verify the app end-to-end
```
pnpm dev          # start on :3210
# open http://localhost:3210 → "Try the demo wallet"
# Dashboard → Autopilot Demo Vault → "Earn" → create intent → "Sign in Xaman (demo wallet)"
# Watch the executor deliver; for exits, wait ~60s for the period roll
```

### Check a tx on the explorer
`https://coston2-explorer.flare.network/tx/<hash>` (or `address/0x7E5F...` for the executor).

---

## What was built new during this hackathon

1. **AutopilotVault** — a Firelight-style redemption-period vault (Foundry, 8 passing tests),
   deployed on Coston2, used to exercise the full lifecycle quickly (60s periods).
2. **Intent engine** — decomposes user outcomes ("deposit", "exit") into exact FSA userOp steps
   with auto-scheduled triggers (`lib/intent/`).
3. **Executor service** — non-custodial delivery of `0xFE` custom instructions: FDC attestation,
   `executeDirectMintingWithData`, nonce management, `DirectMintingDelayed` retries,
   `PaymentAlreadyConfirmed` recovery, period/claim scheduling (`lib/executor/`, `lib/flare/`).
4. **Flare library** — DI-based adapters over Flare Smart Accounts, FAssets and FDC
   (`lib/flare/`) + BigInt-safe persistence (`lib/store.ts`).
5. **Consumer app** — connect XRPL address, live positions across vaults, risk cards, and an
   "Autopilot" inbox that asks for a signature only when one is truly needed.
