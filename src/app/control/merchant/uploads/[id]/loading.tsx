import { PageSkeleton, Skeleton, SkeletonRows } from "@/components/ui/Skeleton";

/** Shaped like the upload page (no full-page spinner). */
export default function Loading() {
  return (
    <>
      <PageSkeleton label="Loading the upload…" rows={3} />
      <div aria-hidden="true" style={{ display: "grid", gap: 10, marginTop: 20 }}><Skeleton height={20} width="40%" /><SkeletonRows rows={10} columns={7} /></div>
    </>
  );
}
