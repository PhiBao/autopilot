"use client";

import { useState } from "react";
import type { VaultDto } from "@/lib/client";
import { RiskBadge } from "@/components/Badges";

export function IntentModal({
  vault,
  kind,
  defaultShares,
  onClose,
  onSubmit,
}: {
  vault: VaultDto;
  kind: "deposit" | "exit";
  defaultShares?: string;
  onClose: () => void;
  onSubmit: (kind: "deposit" | "exit", amountXrp?: string, sharesUba?: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState(kind === "deposit" ? "1" : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sharesXrp = defaultShares ? (Number(defaultShares) / 1_000_000).toFixed(2) : "";

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (kind === "deposit") {
        if (Number(amount) <= 0) throw new Error("Enter an amount greater than 0");
        await onSubmit(kind, amount);
      } else {
        const sharesUba =
          defaultShares && BigInt(defaultShares) > 0n
            ? defaultShares
            : String(Math.round(Number(amount) * 1_000_000));
        if (BigInt(sharesUba) <= 0n) throw new Error("No vault shares to withdraw");
        await onSubmit(kind, undefined, sharesUba);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(4,6,10,0.7)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold text-lg">
            {kind === "deposit" ? "Deposit & earn" : "Exit vault"}
          </h3>
          <RiskBadge level={vault.riskLevel} />
        </div>
        <p className="muted text-sm mb-4">{vault.name}</p>

        <div className="mb-4">
          <label className="block text-xs muted mb-2">
            {kind === "deposit" ? "Amount (XRP)" : "Vault shares (XRP)"}
          </label>
          <input
            className="input mono"
            value={kind === "deposit" ? amount : sharesXrp || amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="1.00"
            inputMode="decimal"
            disabled={kind === "exit" && !!defaultShares}
          />
        </div>

        <div className="mb-4 text-xs muted leading-relaxed">
          {kind === "deposit" ? (
            <>
              One signature mints FXRP from your XRP and deposits it into this vault
              atomically — <span className="text-[--text]">one XRPL transaction</span>, nothing else.
              Withdrawals follow the vault&apos;s period schedule:{" "}
              <span className="text-[--text]">{vault.lockup}</span>.
            </>
          ) : (
            <>
              Two signatures, timed automatically:
              <ol className="list-decimal ml-4 mt-1 space-y-1">
                <li>Burn your vault shares now (request withdrawal).</li>
                <li>
                  When the redemption period rolls, Autopilot prepares the claim and pings you
                  to sign — you never track periods yourself.
                </li>
              </ol>
            </>
          )}
        </div>

        <div className="mb-4 text-xs faint">
          Risk notes:
          <ul className="list-disc ml-4 mt-1 space-y-0.5">
            {vault.riskNotes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>

        {error && <p className="text-sm mb-3" style={{ color: "var(--red)" }}>{error}</p>}

        <div className="flex gap-2">
          <button className="btn btn-ghost flex-1" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary flex-1" onClick={submit} disabled={busy}>
            {busy ? "Preparing…" : kind === "deposit" ? "Create intent" : "Start exit"}
          </button>
        </div>
      </div>
    </div>
  );
}
