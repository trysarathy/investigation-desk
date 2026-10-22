import type { EvidenceStatus } from "@/lib/types";

const LABELS: Record<EvidenceStatus, string> = {
  pass: "Passed",
  warn: "Check",
  fail: "Failed",
  info: "Info",
};

/** Status is always icon plus text, never colour alone. */
export function StatusIcon({ status, size = 14 }: { status: EvidenceStatus; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.75, "aria-hidden": true } as const;
  switch (status) {
    case "pass":
      return <svg {...common}><circle cx="8" cy="8" r="6.5" /><path d="M5 8.2l2 2 4-4.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case "fail":
      return <svg {...common}><circle cx="8" cy="8" r="6.5" /><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" strokeLinecap="round" /></svg>;
    case "warn":
      return <svg {...common}><path d="M8 1.8l6.4 11.4H1.6z" strokeLinejoin="round" /><path d="M8 6.2v3.3M8 11.4v.1" strokeLinecap="round" /></svg>;
    default:
      return <svg {...common}><circle cx="8" cy="8" r="6.5" /><path d="M8 7.2v4M8 4.8v.1" strokeLinecap="round" /></svg>;
  }
}

export function Status({ status, label }: { status: EvidenceStatus; label?: string }) {
  return (
    <span className={`status s-${status}`}>
      <StatusIcon status={status} />
      <span>{label ?? LABELS[status]}</span>
    </span>
  );
}

export function ConfidenceLabel({ confidence, paused }: { confidence: "High" | "Medium" | null; paused?: boolean }) {
  if (paused) return <Status status="warn" label="Paused" />;
  if (confidence === "High") return <Status status="pass" label="High" />;
  if (confidence === "Medium") return <Status status="warn" label="Medium" />;
  return <Status status="info" label="None" />;
}
