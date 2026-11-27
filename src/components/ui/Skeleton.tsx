import u from "./ui.module.css";

/** A placeholder block (decorative; the container carries aria-busy and a status). */
export function Skeleton({ width = "100%", height = 12, className }: { width?: number | string; height?: number | string; className?: string }) {
  return <span aria-hidden="true" className={[u.skel, className ?? ""].filter(Boolean).join(" ")} style={{ width, height }} />;
}

/** Table-shaped placeholder rows. */
export function SkeletonRows({ rows = 8, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className={u.skelTable} aria-hidden="true">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className={u.skelRow} style={{ gridTemplateColumns: `2fr ${"1fr ".repeat(Math.max(0, columns - 1))}` }}>
          {Array.from({ length: columns }, (_, c) => <span key={c} className={u.skel} style={{ height: 10, width: c === 0 ? "70%" : "55%" }} />)}
        </div>
      ))}
    </div>
  );
}

/** A page loading state shaped like the real page: a title, a line, and a table. */
export function PageSkeleton({ label = "Loading…", rows = 8 }: { label?: string; rows?: number }) {
  return (
    <div aria-busy="true" role="status" aria-label={label}>
      <span className={u.srOnly}>{label}</span>
      <span aria-hidden="true" className={`${u.skel} ${u.skelTitle}`} />
      <span aria-hidden="true" className={`${u.skel} ${u.skelLine}`} style={{ width: "60%" }} />
      <div style={{ height: 16 }} />
      <SkeletonRows rows={rows} />
    </div>
  );
}
