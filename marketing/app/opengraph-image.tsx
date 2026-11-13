import { ImageResponse } from "next/og";
export const dynamic = "force-static";
export const alt = "Clearline. Every payment. One clear answer.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
/* Tokens (v2): midnight #101827, white, blue-on-midnight #8FB0FF, on-midnight-muted #A9B4C4,
   midnight-line #2A3548. ImageResponse cannot read CSS variables, so the hex values are repeated here. No gradients. */
export default function Image() {
  return new ImageResponse(
    <div style={{ display: "flex", width: "100%", height: "100%", background: "#101827", color: "#FFFFFF", padding: "64px 72px", flexDirection: "column", justifyContent: "space-between", fontFamily: "serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, fontFamily: "sans-serif" }}>
        <div style={{ width: 44, height: 44, borderRadius: 10, border: "3px solid #FFFFFF", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 24, height: 4, borderRadius: 2, background: "#8FB0FF" }} />
        </div>
        <div style={{ display: "flex", fontSize: 32, fontWeight: 600, letterSpacing: -1 }}>clearline</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 88, letterSpacing: -2, lineHeight: 1.02 }}><span>Every payment.</span><span>One clear answer.</span></div>
        <div style={{ color: "#A9B4C4", fontSize: 26, fontFamily: "sans-serif", maxWidth: 900 }}>Payment instructions, provider events and financial evidence, connected.</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #2A3548", paddingTop: 18, color: "#A9B4C4", fontSize: 18, fontFamily: "sans-serif" }}>
        <span>Early product · Fictional-data sandbox</span><span>Singapore</span>
      </div>
    </div>,
    size,
  );
}
