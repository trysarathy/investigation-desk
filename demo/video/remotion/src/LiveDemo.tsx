// The live demo: a real recording of the app in demo mode (demo/live/record.cjs), edited like the film.
// The camera eases from one focus element to the next (never more than one at a time), a drawn cursor
// follows the recorded moves and clicks, scene changes dip through black, and the caption band, the
// view label and the one "Demo data" label sit in a fixed band under the picture, never over the UI.

import React from "react";
import { AbsoluteFill, Easing, OffthreadVideo, interpolate, staticFile, useCurrentFrame, useVideoConfig, continueRender, delayRender } from "remotion";

export interface DemoTimeline {
  fps: number; duration: number; frames: number; cut: string; video: string; src: [number, number];
  cam: { t: number; box: [number, number, number, number]; red?: boolean; tick?: boolean }[];
  cursor: { t: number; kind: "move" | "click"; x: number; y: number }[];
  dips: { from: number; to: number; label?: string | null }[]; views: { t: number; text: string }[]; end: number | null; badge: [number, number];
  captions: { from: number; to: number; text: string }[]; lines: any[];
}

const C = { bg: "#07090d", text: "#f2f4f7", muted: "#a3aab6", faint: "#6b7280", accent: "#8ea2ff", accent2: "#b9c6ff", teal: "#5fd0c4", red: "#ff8a7f", green: "#66d9a3" };
const FONT = "Inter, system-ui, sans-serif";
const ease = Easing.bezier(0.33, 0, 0.15, 1);
const cl = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const rise = (t: number, at: number, d = 0.5) => interpolate(t, [at, at + d], [0, 1], { ...cl, easing: ease });
const W = 1920, H = 1080, BAND = 172, CY = (H - BAND) / 2;
const MAX_ZOOM = 2.2, PAN = 0.9;

function useFonts() {
  const [h] = React.useState(() => delayRender("fonts"));
  React.useEffect(() => {
    const faces = [400, 500, 600, 700].map((w) => new FontFace("Inter", `url(${staticFile(`fonts/inter-latin-${w}-normal.woff2`)})`, { weight: String(w) }));
    Promise.all(faces.map((f) => f.load())).then((l) => { l.forEach((f) => document.fonts.add(f)); continueRender(h); });
  }, [h]);
}
const useT = () => { const f = useCurrentFrame(); const { fps } = useVideoConfig(); return f / fps; };

type Cam = { cx: number; cy: number; s: number };
/** Frames one box in the picture area above the band: as large as fits (up to MAX_ZOOM), never showing past the recording's edges. */
function frame(box: [number, number, number, number], src: [number, number]): Cam {
  const base = W / src[0];
  const [x, y, w, h] = box;
  const s = Math.max(1, Math.min(MAX_ZOOM, 1760 / (w * base), 800 / (h * base)));
  const K = base * s;
  let cx = x + w / 2, cy = y + h / 2;
  const hw = W / 2 / K; cx = Math.max(hw, Math.min(src[0] - hw, cx));
  cy = Math.max(CY / K, Math.min(src[1] - (H - CY) / K, cy));
  return { cx, cy, s };
}
const mix = (a: Cam, b: Cam, p: number): Cam => ({ cx: a.cx + (b.cx - a.cx) * p, cy: a.cy + (b.cy - a.cy) * p, s: a.s + (b.s - a.s) * p });

function camAt(tl: DemoTimeline, t: number): Cam {
  const ks = tl.cam;
  if (!ks.length) return frame([0, 0, tl.src[0], tl.src[1]], tl.src);
  let k = -1; for (let i = 0; i < ks.length; i++) if (ks[i].t <= t) k = i;
  if (k < 0) return frame(ks[0].box, tl.src);
  const cur = frame(ks[k].box, tl.src);
  if (k === 0) return cur;
  // A page change between two focus points is a cut (under the dip), not a pan across pages.
  const cut = tl.dips.some((d) => d.from > ks[k - 1].t && d.from <= ks[k].t);
  if (cut) return cur;
  return mix(frame(ks[k - 1].box, tl.src), cur, rise(t, ks[k].t, PAN));
}

function cursorAt(tl: DemoTimeline, t: number) {
  const ev = tl.cursor.filter((e) => e.t <= t + 1e-6);
  if (!ev.length) return null;
  const last = ev[ev.length - 1], prev = ev.length > 1 ? ev[ev.length - 2] : null;
  const p = prev ? rise(t, last.t - 0.05, 0.55) : 1;
  const x = prev ? prev.x + (last.x - prev.x) * p : last.x, y = prev ? prev.y + (last.y - prev.y) * p : last.y;
  const click = [...ev].reverse().find((e) => e.kind === "click");
  const ring = click ? interpolate(t, [click.t, click.t + 0.55], [0, 1], cl) : 1;
  return { x, y, ring };
}

function dark(tl: DemoTimeline, t: number) {
  let o = 0;
  for (const d of tl.dips) o = Math.max(o, Math.min(interpolate(t, [d.from, d.from + 0.3], [0, 1], cl), 1 - interpolate(t, [d.to, d.to + 0.3], [0, 1], cl)));
  return o;
}

const Logo: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 64 64">
    <defs><linearGradient id="lgd" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={C.accent2} /><stop offset="1" stopColor={C.accent} /></linearGradient></defs>
    <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#lgd)" />
    <path d="M14 34 H26 L31 40 L48 22" stroke={C.bg} strokeWidth="5.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const EndCard: React.FC<{ a: number }> = ({ a }) => (
  <AbsoluteFill style={{ backgroundColor: C.bg, backgroundImage: `radial-gradient(ellipse 70% 60% at 50% 42%, ${C.accent}24 0%, ${C.bg} 70%)`, opacity: a }}>
    <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H - BAND, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 22, fontFamily: FONT }}>
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}><Logo size={130} /><span style={{ fontSize: 150, fontWeight: 700, letterSpacing: -5, color: C.text }}>Clearline</span></div>
      <div style={{ fontSize: 54, color: C.accent2 }}>Get paid in digital dollars without the detective work.</div>
      <div style={{ marginTop: 14, fontSize: 40, color: C.text, border: `1px solid ${C.accent}88`, borderRadius: 999, padding: "8px 30px" }}>Working demo · seeking early feedback</div>
      <div style={{ marginTop: 10, fontSize: 48, fontWeight: 600, color: C.text }}>Aashmiin Kaur</div>
      <div style={{ fontSize: 36, color: C.muted }}>aashmiin@gmail.com   ·   linkedin.com/in/aashmiin-kaur-479665391</div>
    </div>
  </AbsoluteFill>
);

export const LiveDemo: React.FC<{ timeline: DemoTimeline }> = ({ timeline: tl }) => {
  useFonts();
  const t = useT();
  const cam = camAt(tl, t);
  const K = (W / tl.src[0]) * cam.s;
  const vx = W / 2 - cam.cx * K, vy = CY - cam.cy * K;
  const cur = cursorAt(tl, t);
  const endA = tl.end != null ? rise(t, tl.end, 0.4) : 0;
  const black = Math.max(dark(tl, t), interpolate(t, [0, 0.25], [1, 0], cl), interpolate(t, [tl.duration - 1.0, tl.duration], [0, 1], cl));
  const view = [...tl.views].reverse().find((v) => v.t <= t + 0.4);
  const cap = tl.captions.find((c) => t >= c.from && t < c.to);
  const badge = Math.min(rise(t, tl.badge[0], 0.4), 1 - rise(t, tl.badge[1] - 0.4, 0.4));
  const focus = [...tl.cam].reverse().find((c) => c.t <= t);
  // A page change shows a short chapter card on black, so the viewer knows where we're going next.
  const chap = tl.dips.find((d) => d.label && t >= d.from && t <= d.to + 0.3);
  const chapA = chap ? Math.min(rise(t, chap.from + 0.2, 0.35), 1 - rise(t, chap.to - 0.25, 0.3)) : 0;
  const sx = cur ? (cur.x - cam.cx) * K + W / 2 : 0, sy = cur ? (cur.y - cam.cy) * K + CY : 0;
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, overflow: "hidden" }}>
        <OffthreadVideo src={staticFile(tl.video)} muted style={{ position: "absolute", left: vx, top: vy, width: tl.src[0] * K, height: tl.src[1] * K, maxWidth: "none" }} />
        {cur && endA < 1 && <div style={{ position: "absolute", left: sx, top: sy, width: 0, height: 0 }}>
          {cur.ring < 1 && <div style={{ position: "absolute", left: -38 * (0.4 + cur.ring), top: -38 * (0.4 + cur.ring), width: 76 * (0.4 + cur.ring), height: 76 * (0.4 + cur.ring),
            borderRadius: "50%", border: `4px solid ${C.accent}`, opacity: 1 - cur.ring }} />}
          <svg width="44" height="44" viewBox="0 0 24 24" style={{ position: "absolute", left: -6, top: -4, filter: "drop-shadow(0 3px 6px #000a)" }}>
            <path d="M4 2.5 L4 19 L8.6 14.6 L11.6 21.3 L14.4 20.1 L11.4 13.6 L17.6 13.6 Z" fill="#fff" stroke="#111" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
        </div>}
        {focus?.red && <div style={{ position: "absolute", inset: 0, boxShadow: `inset 0 0 120px ${C.red}22`, pointerEvents: "none" }} />}
      </div>
      {endA > 0 && <EndCard a={endA} />}
      <AbsoluteFill style={{ background: "#000", opacity: black }} />
      {chap && chapA > 0 && <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H - BAND, display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: FONT, fontSize: 72, fontWeight: 600, letterSpacing: -1.5, color: C.text, opacity: chapA, textAlign: "center", padding: "0 160px", boxSizing: "border-box" }}>{chap.label}</div>}
      {/* the band: view label (left) · caption (centre) · demo label (right) */}
      <div style={{ position: "absolute", left: 0, top: H - BAND, width: W, height: BAND, background: "#07090d", borderTop: "1px solid #1c2230", fontFamily: FONT }}>
        {view && endA < 1 && <div style={{ position: "absolute", left: 44, top: 0, height: BAND, display: "flex", alignItems: "center", gap: 12, fontSize: 34, fontWeight: 600, letterSpacing: 1.5,
          textTransform: "uppercase", color: view.text.startsWith("Customer") ? C.teal : C.accent2, opacity: 1 - black }}>
          <span style={{ width: 13, height: 13, borderRadius: 7, background: view.text.startsWith("Customer") ? C.teal : C.accent2 }} />{view.text.replace("'s view", "'s")}<br />view</div>}
        <div style={{ position: "absolute", left: 360, width: W - 720, top: 0, height: BAND, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {cap && <div style={{ fontSize: 46, fontWeight: 600, color: "#fff", textAlign: "center", lineHeight: 1.22 }}>{cap.text}</div>}
        </div>
        {badge > 0 && <div style={{ position: "absolute", right: 44, top: 0, height: BAND, display: "flex", alignItems: "center", opacity: badge }}>
          <div style={{ fontSize: 34, color: C.muted, border: `1px dashed ${C.faint}`, borderRadius: 16, padding: "8px 16px", lineHeight: 1.2, textAlign: "center" }}>Demo data<br />fictional company</div></div>}
      </div>
    </AbsoluteFill>
  );
};
