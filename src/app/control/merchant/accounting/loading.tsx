import { PageSkeleton, Skeleton, SkeletonRows } from "@/components/ui/Skeleton";

/** Shaped like the Accounting export page (no full-page spinner). */
export default function Loading() {
  return (
    <>
      <PageSkeleton label="Loading the journal preview…" rows={0} />
      <div aria-hidden="true" style={{ display: "grid", gap: 12, marginTop: 20 }}><Skeleton height={48} /><SkeletonRows rows={4} columns={4} /><SkeletonRows rows={4} columns={4} /></div>
    </>
  );
}
