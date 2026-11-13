import { ImageResponse } from "next/og";
export const dynamic = "force-static";
export const alt = "Clearline. Money moves. Context gets lost.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
/* Tokens: ink #17212D, ivory #F5F1E8, signal-on-ink #F08A6E, on-ink-muted #B7C2CA. No gradients. */
export default function Image() {
  return new ImageResponse(
    <div style={{ display: "flex", width: "100%", height: "100%", background: "#17212D", color: "#F5F1E8", padding: "64px 72px", flexDirection: "column", justifyContent: "space-between", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 52, height: 52, borderRadius: 8, background: "#F5F1E8", color: "#17212D", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40, fontStyle: "italic", fontFamily: "serif" }}>C</div>
        <div style={{ display: "flex", fontSize: 32, fontWeight: 700, letterSpacing: -1 }}>clearline<span style={{ color: "#D04B31" }}>.</span></div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <div style={{ color: "#F08A6E", fontSize: 18, letterSpacing: 3 }}>CROSS-BORDER PAYMENT OPERATIONS</div>
        <div style={{ display: "flex", flexDirection: "column", fontWeight: 700, fontSize: 76, letterSpacing: -3, lineHeight: 1.05 }}><span>Money moves.</span><span>Context gets lost.</span></div>
        <div style={{ color: "#B7C2CA", fontSize: 26 }}>Instructions, provider updates, reconciliation and exceptions on one record.</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #3B4650", paddingTop: 18, color: "#B7C2CA", fontSize: 18 }}>
        <span>Early product · Fictional-data sandbox</span><span>Singapore</span>
      </div>
    </div>,
    size,
  );
}
