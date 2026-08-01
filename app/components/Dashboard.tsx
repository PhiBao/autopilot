"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type IntentDto, type Position, type VaultDto, formatXrp, DEMO_XRPL } from "@/lib/client";
import { Header } from "@/components/Header";
import { RiskBadge, StepBadge } from "@/components/Badges";
import { IntentModal } from "@/components/IntentModal";

type PositionsDto = {
  xrpl: string;
  personalAccount: string;
  xrpBalance: number;
  fxrp: string;
  fxrpUba: string;
  vaults: Position[];
};

export function Dashboard({ xrpl }: { xrpl: string }) {
  const [positions, setPositions] = useState<PositionsDto | null>(null);
  const [vaults, setVaults] = useState<VaultDto[]>([]);
  const [intents, setIntents] = useState<IntentDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [executor, setExecutor] = useState<{ promoted: number; delivered: number; failed: number } | null>(null);
  const [modal, setModal] = useState<{ vault: VaultDto; kind: "deposit" | "exit"; shares?: string } | null>(null);
  const busyRef = useRef(false);

  const loadPositions = useCallback(async () => {
    try {
      setPositions(await api<PositionsDto>(`/api/positions?xrpl=${encodeURIComponent(xrpl)}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [xrpl]);

  const loadIntents = useCallback(async () => {
    try {
      const r = await api<{ intents: IntentDto[] }>(`/api/intents?xrpl=${encodeURIComponent(xrpl)}`);
      setIntents(r.intents);
    } catch (e) {
      /* non-fatal */
    }
  }, [xrpl]);

  const tick = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const r = await api<{ promoted: number; delivered: number; failed: number }>("/api/executor/tick", {
        method: "POST",
        body: JSON.stringify({ xrpl }),
      });
      setExecutor(r);
    } catch {
      /* non-fatal */
    } finally {
      busyRef.current = false;
    }
  }, [xrpl]);

  useEffect(() => {
    api<{ vaults: VaultDto[] }>("/api/vaults").then((r) => setVaults(r.vaults)).catch(() => {});
    loadPositions();
    loadIntents();
    const p = setInterval(loadPositions, 12_000);
    const i = setInterval(loadIntents, 6_000);
    const t = setInterval(tick, 10_000);
    tick();
    return () => {
      clearInterval(p);
      clearInterval(i);
      clearInterval(t);
    };
  }, [loadPositions, loadIntents, tick]);

  async function createIntent(kind: "deposit" | "exit", vault: VaultDto, amountXrp?: string, shares?: string) {
    const body: Record<string, string> = {
      xrpl,
      kind,
      vaultAddress: vault.address,
    };
    if (kind === "deposit") body.amountXrp = amountXrp ?? "1";
    if (kind === "exit") body.sharesUba = shares ?? "";
    const { intent } = await api<{ intent: IntentDto }>("/api/intents", {
      method: "POST",
      body: JSON.stringify(body),
    });
    setIntents((prev) => [intent, ...prev]);
  }

  async function signStep(intentId: string, opts: { xrplTxHash?: string; demoSign?: boolean }) {
    await api(`/api/intents/${intentId}/sign`, { method: "POST", body: JSON.stringify(opts) });
    await loadIntents();
    await tick();
  }

  const totalEarning = useMemo(() => {
    if (!positions) return "0.00";
    const sum = positions.vaults.reduce((acc, v) => acc + Number(v.assetsXrp), 0);
    return sum.toFixed(2);
  }, [positions]);

  const pendingSigns = useMemo(
    () => intents.filter((i) => i.status === "active" && i.steps.some((s) => s.status === "pending_sign")),
    [intents]
  );

  // Only vaults where the user actually holds shares (registered vaults with a
  // zero balance from getBalances should not clutter "Your vaults").
  const activePositions = useMemo(
    () => (positions ? positions.vaults.filter((v) => BigInt(v.shares) > 0n) : []),
    [positions]
  );

  // Vaults to offer for deposit: the full catalog, minus any vault already held.
  const openVaults = useMemo(() => {
    const held = new Set(activePositions.map((v) => v.vaultAddress.toLowerCase()));
    return vaults.filter((v) => !held.has(v.address.toLowerCase()));
  }, [vaults, activePositions]);

  if (!positions) {
    return (
      <div className="flex-1">
        <Header xrpl={xrpl} />
        <div className="max-w-6xl mx-auto px-6 py-16 text-center muted">Connecting to Flare…</div>
      </div>
    );
  }

  return (
    <div className="flex-1">
      <Header xrpl={xrpl} />
      {error && (
        <div className="max-w-6xl mx-auto px-6 pt-4 text-sm" style={{ color: "var(--red)" }}>
          {error}
        </div>
      )}

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Overview */}
        <section className="grid grid-cols-3 gap-4 mb-8">
          <div className="card">
            <div className="text-xs muted mb-1">XRP earning in vaults</div>
            <div className="text-2xl font-bold tracking-tight">{totalEarning}</div>
            <div className="text-xs faint mt-1">XRP</div>
          </div>
          <div className="card">
            <div className="text-xs muted mb-1">FXRP ready to deploy</div>
            <div className="text-2xl font-bold tracking-tight">{positions.fxrp}</div>
            <div className="text-xs faint mt-1">in your smart account</div>
          </div>
          <div className="card">
            <div className="text-xs muted mb-1">On the XRP Ledger</div>
            <div className="text-2xl font-bold tracking-tight">{positions.xrpBalance.toFixed(2)}</div>
            <div className="text-xs faint mt-1">idle — put it to work</div>
          </div>
        </section>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Left: vaults */}
          <section className="lg:col-span-2 space-y-8">
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Your vaults</h2>
                <span className="text-xs muted">Live from Flare</span>
              </div>
              {activePositions.length === 0 ? (
                <div className="card text-center py-10 muted">
                  No positions yet. Deposit XRP into a vault below and Autopilot handles the rest.
                </div>
              ) : (
                <div className="space-y-3">
                  {activePositions.map((v) => (
                    <VaultPositionRow
                      key={v.vaultId}
                      v={v}
                      onAdd={() => setModal({ vault: vaults.find((x) => x.address === v.vaultAddress) ?? vaultFromPosition(v), kind: "deposit" })}
                      onExit={() => setModal({ vault: vaults.find((x) => x.address === v.vaultAddress) ?? vaultFromPosition(v), kind: "exit", shares: v.shares })}
                    />
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Available vaults</h2>
                <span className="text-xs muted">Earn XRP yield on Flare</span>
              </div>
              <div className="space-y-3">
                {openVaults.map((v) => (
                  <VaultCatalogRow key={v.address} v={v} onDeposit={() => setModal({ vault: v, kind: "deposit" })} />
                ))}
              </div>
            </div>
          </section>

          {/* Right: autopilot activity */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Autopilot</h2>
              <span className="text-xs muted">
                {executor ? `${executor.delivered} delivered` : "idle"}
              </span>
            </div>

            {pendingSigns.length > 0 && (
              <div className="mb-4 space-y-3">
                <div className="text-xs muted uppercase tracking-wide">Needs your signature</div>
                {pendingSigns.map((i) => (
                  <SignCard key={i.id} intent={i} isDemo={xrpl.toLowerCase() === DEMO_XRPL.toLowerCase()} onSign={signStep} />
                ))}
              </div>
            )}

            <div className="text-xs muted uppercase tracking-wide mb-3">Activity</div>
            {intents.length === 0 ? (
              <div className="card text-center py-8 muted text-sm">
                Nothing running yet.
                <br />
                Start a deposit or exit and watch it complete here.
              </div>
            ) : (
              <div className="space-y-3">
                {intents.map((i) => (
                  <IntentCard key={i.id} intent={i} />
                ))}
              </div>
            )}
          </section>
        </div>
      </main>

      {modal && (
        <IntentModal
          vault={modal.vault}
          kind={modal.kind}
          defaultShares={modal.shares}
          onClose={() => setModal(null)}
          onSubmit={async (kind, amountXrp, shares) => {
            await createIntent(kind, modal.vault, amountXrp, shares);
            setModal(null);
            await tick();
          }}
        />
      )}
    </div>
  );
}

function vaultFromPosition(p: Position): VaultDto {
  return {
    id: p.vaultId,
    address: p.vaultAddress,
    type: p.type,
    name: p.name,
    operator: p.operator,
    strategy: p.strategy,
    lockup: p.lockup,
    riskLevel: p.riskLevel,
    riskNotes: [],
    apyBps: p.apyBps,
    capXrp: null,
    deployed: false,
  };
}

function VaultPositionRow({
  v,
  onAdd,
  onExit,
}: {
  v: Position;
  onAdd: () => void;
  onExit: () => void;
}) {
  return (
    <div className="card flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold">{v.name}</span>
          <RiskBadge level={v.riskLevel} />
        </div>
        <div className="muted text-sm mt-1 truncate">{v.strategy}</div>
      </div>
      <div className="text-right shrink-0">
        <div className="font-bold text-lg">{v.assetsXrp} <span className="text-xs muted">XRP</span></div>
        <div className="flex gap-2 mt-1.5 justify-end">
          <button className="btn btn-primary btn-sm" onClick={onAdd}>Add</button>
          <button className="btn btn-ghost btn-sm" onClick={onExit}>Exit</button>
        </div>
      </div>
    </div>
  );
}

function VaultCatalogRow({ v, onDeposit }: { v: VaultDto; onDeposit: () => void }) {
  return (
    <div className="card-soft p-4 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm">{v.name}</span>
          <RiskBadge level={v.riskLevel} />
          {v.deployed && <span className="badge badge-pending">demo</span>}
        </div>
        <div className="muted text-xs mt-1 truncate">{v.operator} · {v.lockup}</div>
      </div>
      <button className="btn btn-primary btn-sm shrink-0" onClick={onDeposit}>
        Earn →
      </button>
    </div>
  );
}

function SignCard({
  intent,
  isDemo,
  onSign,
}: {
  intent: IntentDto;
  isDemo: boolean;
  onSign: (intentId: string, opts: { xrplTxHash?: string; demoSign?: boolean }) => Promise<void>;
}) {
  const [txHash, setTxHash] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const step = intent.steps.find((s) => s.status === "pending_sign");
  const userOp = step?.userOp;

  async function run(opts: { xrplTxHash?: string; demoSign?: boolean }) {
    setBusy(true);
    setError(null);
    try {
      await onSign(intent.id, opts);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="card-soft p-4" style={{ borderColor: "rgba(96,165,250,0.4)" }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-semibold">{step?.label ?? intent.kind}</span>
        <StepBadge status={step?.status ?? "pending_sign"} />
      </div>
      <p className="text-xs muted mb-3">{step?.detail}</p>

      {isDemo ? (
        <button className="btn btn-primary btn-sm w-full" disabled={busy} onClick={() => run({ demoSign: true })}>
          {busy ? "Signing…" : "Sign with demo wallet"}
        </button>
      ) : (
        <>
          {userOp && (
            <div className="card bg-[--bg] p-3 mb-3 text-xs space-y-1.5">
              <div className="flex justify-between gap-2">
                <span className="faint shrink-0">Send to</span>
                <button
                  className="mono truncate text-left hover:text-[--accent]"
                  onClick={() => copy(userOp.destination)}
                  title={userOp.destination}
                >
                  {userOp.destination}
                </button>
              </div>
              <div className="flex justify-between gap-2">
                <span className="faint shrink-0">Amount</span>
                <span className="mono">{userOp.paymentAmountXrp.toFixed(2)} XRP</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="faint shrink-0">Memo</span>
                <button
                  className="mono text-left truncate hover:text-[--accent]"
                  onClick={() => copy(userOp.memo.slice(2))}
                  title={userOp.memo}
                >
                  {userOp.memo.slice(0, 18)}…
                </button>
              </div>
              <button className="btn btn-ghost btn-sm w-full mt-1" onClick={() => copy(userOp.memo.slice(2))}>
                {copied ? "Copied ✓" : "Copy payment memo"}
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <input
              className="input mono !py-2 text-xs"
              placeholder="Paste the XRPL tx hash after signing"
              value={txHash}
              onChange={(e) => setTxHash(e.target.value)}
            />
            <button
              className="btn btn-primary btn-sm shrink-0"
              disabled={busy || !txHash}
              onClick={() => run({ xrplTxHash: txHash.trim() })}
            >
              {busy ? "…" : "Confirm"}
            </button>
          </div>
          <p className="text-[11px] faint mt-2 leading-relaxed">
            Sign this Payment in a memo-capable wallet (Xaman, Joey, …) using the memo above,
            then paste the tx hash — Autopilot takes it from there.
          </p>
        </>
      )}
      {error && <p className="text-xs mt-2" style={{ color: "var(--red)" }}>{error}</p>}
    </div>
  );
}

function IntentCard({ intent }: { intent: IntentDto }) {
  const next = intent.steps.find((s) => s.status === "pending_sign" || s.status === "waiting" || s.status === "signed");
  const label = intent.kind === "deposit" ? "Deposit" : "Exit";
  const amount = formatXrp(BigInt(intent.amountUBA));
  return (
    <div className="card-soft p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="font-semibold text-sm">{label}</span>
          <span className="muted text-xs ml-2">{amount} XRP</span>
        </div>
        <span className="badge badge-pending">{intent.status}</span>
      </div>
      <div className="space-y-1.5">
        {intent.steps.map((s) => (
          <div key={s.id} className="flex items-center gap-2 text-xs">
            <span className={s.status === "executed" ? "text-[--green]" : s.status === "failed" ? "text-[--red]" : "text-[--text-muted]"}>
              {s.status === "executed" ? "✓" : s.status === "pending_sign" ? "◉" : s.status === "failed" ? "✕" : "·"}
            </span>
            <span className="muted">{s.label}</span>
            <span className="ml-auto flex items-center gap-2">
              {s.status === "waiting" && s.triggerAt ? (
                <Countdown to={s.triggerAt} />
              ) : (
                <StepBadge status={s.status} />
              )}
            </span>
          </div>
        ))}
      </div>
      {intent.steps.some((s) => s.status === "failed") && (
        <p className="text-xs mt-2" style={{ color: "var(--red)" }}>
          {intent.steps.find((s) => s.status === "failed")?.error}
        </p>
      )}
    </div>
  );
}

function Countdown({ to }: { to: number }) {
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.round((to - Date.now()) / 1000)));
  useEffect(() => {
    const t = setInterval(() => setRemaining(Math.max(0, Math.round((to - Date.now()) / 1000))), 1000);
    return () => clearInterval(t);
  }, [to]);
  return <span className="badge badge-pending">claimable in {remaining}s</span>;
}
