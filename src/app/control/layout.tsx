import type { Metadata } from "next";
import type { ReactNode } from "react";
import s from "@/components/control/control.module.css";

// Every Control page is rendered per request (session, organisation and the CSP nonce are per request).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Clearline Control", template: "%s · Clearline Control" },
  description: "Clearline Control private staging. Fictional data; no real payments.",
  robots: { index: false, follow: false },
};

const STAGING_LABEL = "PRIVATE STAGING — FICTIONAL DATA (no real payments)";

export default function ControlRootLayout({ children }: { children: ReactNode }) {
  return (
    <div className={s.root}>
      <aside className={s.staging} aria-label="Environment notice"><p className={s.stagingText} data-testid="staging-label">{STAGING_LABEL}</p></aside>
      {children}
    </div>
  );
}
