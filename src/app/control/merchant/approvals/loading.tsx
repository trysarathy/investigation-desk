import { PageSkeleton, Skeleton, SkeletonRows } from "@/components/ui/Skeleton";

/** Shaped like the Approvals page (no full-page spinner). */
export default function Loading() {
  return (
    <>
      <PageSkeleton label="Loading the approvals…" rows={0} />
      <div aria-hidden="true" style={{ display: "grid", gap: 12, marginTop: 20 }}><Skeleton height={180} /><Skeleton height={180} /><SkeletonRows rows={4} columns={5} /></div>
    </>
  );
}
