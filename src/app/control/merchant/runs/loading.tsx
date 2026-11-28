import { PageSkeleton, Skeleton, SkeletonRows } from "@/components/ui/Skeleton";

/** Shaped like the Runs page (no full-page spinner). */
export default function Loading() {
  return (
    <>
      <PageSkeleton label="Loading the runs…" rows={2} />
      <div aria-hidden="true" style={{ display: "grid", gap: 10, marginTop: 20 }}><Skeleton height={120} /><SkeletonRows rows={5} columns={8} /><SkeletonRows rows={6} columns={10} /></div>
    </>
  );
}
