import { PageSkeleton } from "@/components/ui/Skeleton";

/** v1 design-fluid: shaped like the page that is coming (a title, a line and a table), never a full-page spinner. */
export default function MerchantLoading() {
  return <PageSkeleton label="Loading the stored reconciliation…" />;
}
