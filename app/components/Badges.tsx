"use client";

export function RiskBadge({ level }: { level: string }) {
  const label = level.charAt(0).toUpperCase() + level.slice(1);
  return <span className={`badge badge-${level}`}>{label} risk</span>;
}

export function StepBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    pending_sign: ["Sign required", "badge-pending"],
    signed: ["Signed · executing", "badge-pending"],
    waiting: ["Waiting", ""],
    executed: ["Done", "badge-done"],
    failed: ["Failed", "badge-high"],
  };
  const [label, cls] = map[status] ?? [status, ""];
  return <span className={`badge ${cls}`}>{label}</span>;
}
