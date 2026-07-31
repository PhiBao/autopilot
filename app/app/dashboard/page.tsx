"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CONNECT_KEY } from "@/lib/client";
import { Dashboard } from "@/components/Dashboard";

export default function DashboardPage() {
  const router = useRouter();
  const [xrpl, setXrpl] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(CONNECT_KEY);
    if (stored) {
      setXrpl(stored);
    } else {
      router.replace("/");
    }
  }, [router]);

  if (!xrpl) return null;
  return <Dashboard xrpl={xrpl} />;
}
