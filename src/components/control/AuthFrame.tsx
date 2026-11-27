import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { ProductMark } from "./member-status";
import x from "./screens.module.css";

/**
 * v1 design-fluid: the calm, centred frame of the signed-out screens (sign-in, the second step, password reset,
 * e-mail verification, invitation). The product name, the theme toggle, one card with one form, then the small print.
 * The environment notice (the pilot banner) stays above it, in the Control root layout, word for word.
 */
export function AuthFrame({ title, eyebrow = "Clearline Control", lede, children, foot, otp }: { title: string; eyebrow?: string; lede?: ReactNode; children: ReactNode; foot?: ReactNode; otp?: boolean }) {
  return (
    <main className={x.auth} id="main">
      <div className={x.authCard}>
        <div className={x.authTop}>
          <p className={x.product}><ProductMark className={x.mark} />{eyebrow}</p>
          <ThemeToggle />
        </div>
        <h1>{title}</h1>
        {lede ? <p className={x.authLede}>{lede}</p> : null}
        <div className={`${x.authBody} ${otp ? x.otp : ""}`}>{children}</div>
      </div>
      {foot ? <div className={x.authFoot}>{foot}</div> : null}
    </main>
  );
}
