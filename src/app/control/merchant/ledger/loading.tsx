import { PageSkeleton, Skeleton } from "@/components/ui/Skeleton";

/** Shaped like the Ledger page (no full-page spinner). */
export default function Loading() {
  return (
    <>
      <PageSkeleton label="Loading the ledger connections…" rows={0} />
      <div aria-hidden="true" style={{ display: "grid", gap: 12, marginTop: 20 }}><Skeleton height={110} /><Skeleton height={80} /></div>
    </>
  );
}
