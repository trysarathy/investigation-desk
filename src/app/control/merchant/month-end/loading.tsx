import { PageSkeleton, Skeleton, SkeletonRows } from "@/components/ui/Skeleton";

/** Shaped like the Month-end page (no full-page spinner). */
export default function Loading() {
  return (
    <>
      <PageSkeleton label="Loading the month-end view…" rows={4} />
      <div aria-hidden="true" style={{ display: "grid", gap: 10, marginTop: 20 }}><Skeleton height={72} /><SkeletonRows rows={5} columns={2} /></div>
    </>
  );
}
