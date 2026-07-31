"use client";

import { useRouter } from "next/navigation";
import { CONNECT_KEY, shortAddress } from "@/lib/client";

export function Header({ xrpl }: { xrpl: string }) {
  const router = useRouter();
  return (
    <header className="flex items-center justify-between px-6 md:px-10 py-4 border-b border-[--border]">
      <button className="flex items-center gap-2" onClick={() => router.push("/")}>
        <span className="w-7 h-7 rounded-full bg-[--accent] flex items-center justify-center">
          <span className="w-2 h-2 rounded-full bg-[--accent-ink]" />
        </span>
        <span className="font-semibold tracking-tight">Autopilot</span>
      </button>
      <div className="flex items-center gap-3">
        <span className="badge badge-done hidden sm:inline-flex">
          <span className="w-1.5 h-1.5 rounded-full bg-[--green]" />
          coston2
        </span>
        <span className="mono text-sm card-soft px-3 py-1.5 text-xs" title={xrpl}>
          {shortAddress(xrpl, 8)}
        </span>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            localStorage.removeItem(CONNECT_KEY);
            router.push("/");
          }}
        >
          Disconnect
        </button>
      </div>
    </header>
  );
}
