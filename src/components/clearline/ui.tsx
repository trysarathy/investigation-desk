"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import s from "./ui.module.css";

export { s as ui };

export type Tone = "ok" | "warn" | "bad" | "info" | "neutral";

/** Status chip: tone is decoration; the text always carries the meaning. */
export function Chip({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span className={`${s.chip} ${s[tone]}`} title={title}>{children}</span>;
}

/** Explanation/engine code shown verbatim in mono. */
export function Code({ children }: { children: ReactNode }) {
  return <code className={s.code}>{children}</code>;
}

export function PageHead({ eyebrow, title, lede, actions }: { eyebrow?: string; title: string; lede?: ReactNode; actions?: ReactNode }) {
  return (
    <div className={s.pageHead}>
      <div>
        {eyebrow && <p className={s.eyebrow}>{eyebrow}</p>}
        <h1>{title}</h1>
        {lede && <p className={s.lede}>{lede}</p>}
      </div>
      {actions && <div className={s.actions}>{actions}</div>}
    </div>
  );
}

export function Panel({ title, actions, children, id, headingLevel = 2 }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; id?: string; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <section className={s.panel} id={id} aria-labelledby={id && title ? id + "-h" : undefined}>
      {title && (
        <div className={s.panelHead}>
          <H id={id ? id + "-h" : undefined}>{title}</H>
          {actions && <div className={s.actions}>{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className={s.empty}>{children}</p>;
}

export function Notice({ children, info }: { children: ReactNode; info?: boolean }) {
  return <div className={`${s.notice} ${info ? s.noticeInfo : ""}`}>{children}</div>;
}

export function Metric({ href, label, value, note }: { href: string; label: string; value: ReactNode; note: string }) {
  return (
    <Link href={href} className={s.metric}>
      <span className={s.metricLabel}>{label}</span>
      <span className={s.metricValue}>{value}</span>
      <span className={s.metricNote}>{note}</span>
    </Link>
  );
}

export function Btn({ kind, size, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: "primary" | "ghost"; size?: "small" }) {
  const cls = [s.btn, kind ? s[kind] : "", size ? s[size] : "", rest.className ?? ""].join(" ");
  return <button type="button" {...rest} className={cls} />;
}

export function LinkBtn({ href, kind, size, children }: { href: string; kind?: "primary" | "ghost"; size?: "small"; children: ReactNode }) {
  return <Link href={href} className={[s.btn, kind ? s[kind] : "", size ? s[size] : ""].join(" ")}>{children}</Link>;
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className={s.field}>
      <span>{label}</span>
      {children}
      {hint && <span className={s.hint}>{hint}</span>}
      {error && <span className={s.err} role="alert">{error}</span>}
    </label>
  );
}

export function Status({ msg }: { msg: { text: string; error?: boolean } | null }) {
  return (
    <div aria-live="polite" role="status">
      {msg && <p className={`${s.status} ${msg.error ? s.statusErr : ""}`}>{msg.text}</p>}
    </div>
  );
}

export function Dl({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className={s.dl}>
      {items.map(([k, v], i) => (
        <div key={i}><dt>{k}</dt><dd>{v}</dd></div>
      ))}
    </dl>
  );
}

/** ISO timestamp rendered as SGT, deterministic (no locale drift between server and client). */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const d = new Date(t + 8 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} SGT`;
}
export function fmtDate(iso: string | null | undefined): string {
  return iso ? fmtTime(iso).slice(0, 10) : "—";
}
