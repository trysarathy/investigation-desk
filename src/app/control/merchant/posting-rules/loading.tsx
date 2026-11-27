import { PageSkeleton, Skeleton, SkeletonRows } from "@/components/ui/Skeleton";

/** Shaped like the Posting rules page (no full-page spinner). */
export default function Loading() {
  return (
    <>
      <PageSkeleton label="Loading the posting rules…" rows={0} />
      <div aria-hidden="true" style={{ display: "grid", gap: 12, marginTop: 20 }}><Skeleton height={60} /><SkeletonRows rows={3} columns={3} /><SkeletonRows rows={3} columns={3} /></div>
    </>
  );
}
