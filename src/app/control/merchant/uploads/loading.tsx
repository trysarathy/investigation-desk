import { PageSkeleton, Skeleton, SkeletonRows } from "@/components/ui/Skeleton";

/** Shaped like the Uploads page (no full-page spinner). */
export default function Loading() {
  return (
    <>
      <PageSkeleton label="Loading your uploads…" rows={2} />
      <div aria-hidden="true" style={{ display: "grid", gap: 10, marginTop: 20 }}><Skeleton height={96} /><SkeletonRows rows={6} columns={6} /></div>
    </>
  );
}
