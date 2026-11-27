import s from "@/components/control/control.module.css";
import { PageSkeleton } from "@/components/ui/Skeleton";

/** Shown while a Control page loads: shaped like a page (title and table), never a full-page spinner. */
export default function ControlLoading() {
  return <main className={s.main} aria-busy="true"><PageSkeleton label="Loading…" /></main>;
}
