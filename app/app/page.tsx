"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, CONNECT_KEY } from "@/lib/client";

const STEPS = [
  {
    n: "01",
    title: "Connect your XRPL wallet",
    body: "Paste any XRPL address. Your Flare Smart Account is resolved automatically — no new wallet, no gas token, no bridging.",
  },
  {
    n: "02",
    title: "Tell us the outcome",
    body: "“Earn on this XRP”, “get me out by Friday”, “compound it monthly”. We decompose it into the exact on-chain steps.",
  },
  {
    n: "03",
    title: "Sign when we ping you",
    body: "One tap in the wallet you already use. Autopilot handles the epochs, claims, nonces, proofs and recovery in between.",
  },
];

const PROBLEMS = [
  "Vault deposits are one signature. Exits are four steps across two days — redeem, find the period, wait for it to roll, then claim.",
  "If you miss the claim window, your XRP sits in limbo. If two payments collide on a nonce, funds get stuck at the Core Vault.",
  "Redeeming FXRP back to XRP has its own redemption queue and timing. Nobody explains the second half of the journey.",
  "Two vaults, different risk profiles, slashing exposure, caps that fill up. You are flying blind on your own savings.",
];

export default function Home() {
  const router = useRouter();
  const [xrpl, setXrpl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect(address: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/connect?xrpl=${encodeURIComponent(address)}`);
      localStorage.setItem(CONNECT_KEY, address);
      router.push("/dashboard");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex-1">
      {/* Header */}
      <header className="flex items-center justify-between px-6 md:px-10 py-5 border-b border-[--border]">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-full bg-[--accent] flex items-center justify-center">
            <span className="w-2.5 h-2.5 rounded-full bg-[--accent-ink]" />
          </span>
          <span className="font-semibold tracking-tight text-lg">Autopilot</span>
          <span className="badge">for XRP on Flare</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden md:block muted text-sm">Live on Flare testnet</span>
          <button className="btn btn-ghost btn-sm" onClick={() => router.push("/dashboard")}>
            Open app
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="px-6 md:px-10 pt-16 md:pt-24 pb-12 max-w-5xl mx-auto">
        <div className="badge badge-low mb-6">Flare Summer Signal · Interoperable Asset Products</div>
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight leading-[1.05] max-w-3xl">
          Your XRP, <span className="gradient-text">on autopilot.</span>
        </h1>
        <p className="mt-6 text-lg md:text-xl muted max-w-2xl leading-relaxed">
          Earning on XRP through Flare is easy to enter and painful to leave. Autopilot is the
          lifecycle manager between the two — one signature in, one signature out. Epochs, claims,
          nonces and proofs are our problem, not yours.
        </p>

        <div className="mt-10 max-w-xl">
          <label className="block text-sm muted mb-2">Connect an XRPL address</label>
          <div className="flex gap-2">
            <input
              className="input mono"
              placeholder="rLReZoi6KFGeDC6pZv6kNuAGzhaSyJ4CMb"
              value={xrpl}
              onChange={(e) => setXrpl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && xrpl && connect(xrpl)}
            />
            <button className="btn btn-primary" disabled={busy || !xrpl} onClick={() => connect(xrpl)}>
              Connect
            </button>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => connect(process.env.NEXT_PUBLIC_DEMO_XRPL || "rLReZoi6KFGeDC6pZv6kNuAGzhaSyJ4CMb")}>
              Try the demo wallet →
            </button>
            <span className="faint text-xs">demo funds on the Flare testnet</span>
          </div>
          {error && <p className="mt-3 text-sm" style={{ color: "var(--red)" }}>{error}</p>}
        </div>
      </section>

      {/* Problem */}
      <section className="border-t border-[--border] bg-[--bg-soft] py-16 px-6 md:px-10">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight">
            Deposits are solved. <span className="muted">The other half of the journey isn’t.</span>
          </h2>
          <div className="mt-8 grid md:grid-cols-2 gap-4">
            {PROBLEMS.map((p, i) => (
              <div key={i} className="card-soft p-5 text-sm leading-relaxed muted">
                <span className="mono text-xs block mb-2" style={{ color: "var(--accent)" }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                {p}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-16 px-6 md:px-10 max-w-5xl mx-auto">
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight">How it works</h2>
        <div className="mt-8 grid md:grid-cols-3 gap-4">
          {STEPS.map((s) => (
            <div key={s.n} className="card">
              <div className="mono text-xs mb-3" style={{ color: "var(--accent)" }}>{s.n}</div>
              <h3 className="font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm muted leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 text-center">
          <button className="btn btn-primary" onClick={() => router.push("/dashboard")}>
            Open the app
          </button>
        </div>
      </section>

      <footer className="border-t border-[--border] px-6 py-8 text-center faint text-sm">
        Autopilot · built on Flare Smart Accounts, FAssets and the Flare Data Connector · non-custodial, no new wallet
      </footer>
    </main>
  );
}
