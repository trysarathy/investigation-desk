// The Clearline product film. Every scene is driven by the generated timeline (times in seconds),
// so the picture follows the narration: captions come from the spoken words, and each zoom, click
// and reveal is anchored to the word it belongs with. Product shots are real screenshots of the app.

import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig, continueRender, delayRender } from "remotion";

export type Rect = [number, number, number, number];
interface Base { kind: string; from: number; to: number }
export interface Timeline {
  fps: number; duration: number; frames: number; cut: string;
  scenes: (Base & Record<string, any>)[];
  captions: { from: number; to: number; text: string }[];
  lines: { i: number; section: string; from: number; to: number; spoken: string; display: string }[];
}

// ---------- look ----------
const C = {
  bg: "#0a0c11", bg2: "#11141b", text: "#eef0f4", muted: "#9aa1ad", faint: "#5d6470",
  accent: "#7b93f5", accent2: "#a7b6ff", amber: "#efb95c", red: "#f1877d", green: "#62d29a",
};
const FONT = "Inter, system-ui, sans-serif";
const ease = Easing.bezier(0.33, 0, 0.15, 1);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

function useFonts() {
  const [handle] = React.useState(() => delayRender("fonts"));
  React.useEffect(() => {
    const faces = [400, 500, 600, 700].map((w) => new FontFace("Inter", `url(${staticFile(`fonts/inter-latin-${w}-normal.woff2`)})`, { weight: String(w) }));
    Promise.all(faces.map((f) => f.load())).then((loaded) => { loaded.forEach((f) => document.fonts.add(f)); continueRender(handle); });
  }, [handle]);
}

const useT = () => { const f = useCurrentFrame(); const { fps } = useVideoConfig(); return f / fps; };
const useDims = () => { const { width, height } = useVideoConfig(); return { W: width, H: height, vertical: height > width, u: Math.min(width, height) / 1080 }; };

/** 0→1 as t passes `at` (over `d` seconds). */
const rise = (t: number, at: number, d = 0.5) => interpolate(t, [at, at + d], [0, 1], { ...clamp, easing: ease });

// ---------- backdrops ----------
const Backdrop: React.FC<{ glow?: string }> = ({ glow = C.accent }) => {
  const t = useT(); const { W, H } = useDims();
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at ${50 + 8 * Math.sin(t / 6)}% ${38 + 6 * Math.cos(t / 7)}%, ${glow}22 0%, ${C.bg} 55%)` }}>
      <svg width={W} height={H} style={{ position: "absolute", opacity: 0.18 }}>
        <defs><pattern id="g" width="64" height="64" patternUnits="userSpaceOnUse" patternTransform={`translate(${-(t * 6) % 64} 0)`}>
          <path d="M64 0H0V64" fill="none" stroke="#ffffff" strokeOpacity="0.07" /></pattern></defs>
        <rect width="100%" height="100%" fill="url(#g)" />
      </svg>
    </AbsoluteFill>
  );
};

const Logo: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 64 64">
    <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={C.accent2} /><stop offset="1" stopColor={C.accent} /></linearGradient></defs>
    <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#lg)" />
    <path d="M14 34 H26 L31 40 L48 22" stroke="#0a0c11" strokeWidth="5.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// ---------- scenes ----------
const Hook: React.FC<{ s: any }> = ({ s }) => {
  const t = useT(); const { W, H, u } = useDims();
  const [b1, b2] = s.beats;
  const stall = rise(t, b2.at - 0.4, 1.4);
  // The payment line: streaks across fast, then on the second beat it slows, stops and turns amber.
  const p1 = ((t - b1.at + 0.4) * 1.6) % 1.4;
  const x = stall > 0 ? interpolate(stall, [0, 1], [W * 0.15, W * 0.55]) : interpolate(p1, [0, 1.4], [-W * 0.3, W * 1.1]);
  const col = stall > 0.6 ? C.amber : C.accent2;
  const w1 = rise(t, b1.at, 0.45) * (1 - rise(t, b2.at - 0.25, 0.3));
  const w2 = rise(t, b2.at, 0.5);
  const big = 150 * u;
  return (
    <AbsoluteFill>
      <Backdrop glow={stall > 0.5 ? C.amber : C.accent} />
      <div style={{ position: "absolute", top: H * 0.62, left: 0, width: W, height: 2, background: "#ffffff10" }} />
      <div style={{ position: "absolute", top: H * 0.62 - 2, left: x - W * 0.25, width: W * 0.25, height: 6, borderRadius: 3,
        background: `linear-gradient(90deg, transparent, ${col})`, boxShadow: `0 0 24px ${col}`, opacity: stall > 0.98 ? 0.6 + 0.4 * Math.sin(t * 6) : 1 }} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", fontFamily: FONT }}>
        <div style={{ position: "absolute", fontSize: big, fontWeight: 600, letterSpacing: -4 * u, color: C.text, opacity: w1, transform: `translateY(${(1 - w1) * 30}px)` }}>Seconds.</div>
        <div style={{ position: "absolute", fontSize: big, fontWeight: 600, letterSpacing: -4 * u, color: C.amber, opacity: w2, transform: `translateY(${(1 - w2) * 30}px)` }}>Hours.</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Bubble: React.FC<{ m: any; k: number; dim: number }> = ({ m, k, dim }) => {
  const t = useT(); const { u, vertical } = useDims();
  const a = rise(t, m.at, 0.45);
  return (
    <div style={{ opacity: a * (1 - 0.65 * dim), transform: `translateY(${(1 - a) * 26}px) scale(${1 - 0.04 * dim})`, filter: `blur(${dim * 3}px)`,
      display: "flex", gap: 18 * u, alignItems: "flex-start", width: vertical ? "100%" : 1000 * u }}>
      <div style={{ width: 52 * u, height: 52 * u, borderRadius: 26 * u, background: "#232836", color: C.muted, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: 22 * u, flex: "none" }}>{m.who[0]}</div>
      <div style={{ background: "#171b24", border: "1px solid #262b38", borderRadius: 18 * u, padding: `${16 * u}px ${22 * u}px`, flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 19 * u, color: C.muted, marginBottom: 6 * u }}>
          <span>{m.who}</span>
          <span style={{ color: C.amber, background: "#efb95c1c", borderRadius: 999, padding: `${2 * u}px ${12 * u}px`, opacity: rise(t, m.at + 0.5, 0.4) }}>{m.tag}</span>
        </div>
        <div style={{ fontSize: 30 * u, color: C.text, lineHeight: 1.3 }}>{m.text}</div>
      </div>
    </div>
  );
};

const Problem: React.FC<{ s: any }> = ({ s }) => {
  const t = useT(); const { W, H, u, vertical } = useDims();
  const dim = rise(t, s.dig, 0.8);
  const panels = [
    { title: "Block explorer", rows: ["0x00000000…69b01a  Success  7,500 USDT", "0x00000000…a52f60  Success  2,180 USDC", "0x00000000…4566d9  Pending", "0x00000000…3e748e  Success  1,980 USDC"] },
    { title: "Spreadsheet", rows: ["INV-1042   5,000.00   ?", "INV-1043   7,500.00   ?", "INV-1044   3,200.00   ?", "INV-1045   2,180.00   ?"] },
    { title: "Email threads", rows: ["Re: Any update on this?", "Re: Which wallet did you use?", "Re: Can you send the hash?", "Re: Still checking…"] },
  ];
  const waiting = rise(t, s.digWords[3], 0.5);
  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill style={{ fontFamily: FONT, padding: vertical ? `${H * 0.12}px ${W * 0.06}px` : `${H * 0.11}px ${W * 0.14}px`, gap: 22 * u, flexDirection: "column" }}>
        <div style={{ fontSize: 22 * u, letterSpacing: 3 * u, textTransform: "uppercase", color: C.faint, opacity: rise(t, s.intro, 0.6) }}>Support inbox · every day</div>
        {s.msgs.map((m: any, k: number) => <Bubble key={k} m={m} k={k} dim={dim} />)}
      </AbsoluteFill>
      <AbsoluteFill style={{ fontFamily: FONT, justifyContent: "center", alignItems: "center", flexDirection: vertical ? "column" : "row", gap: 28 * u }}>
        {panels.map((p, k) => {
          const a = rise(t, s.digWords[k], 0.5);
          return (
            <div key={p.title} style={{ opacity: a, transform: `translateY(${(1 - a) * 40}px) rotate(${(k - 1) * 1.5}deg)`, width: (vertical ? 820 : 520) * u,
              background: "#141823ee", border: "1px solid #2a3040", borderRadius: 16 * u, padding: 22 * u, boxShadow: "0 30px 80px #0009" }}>
              <div style={{ fontSize: 22 * u, color: C.muted, marginBottom: 12 * u, fontWeight: 600 }}>{p.title}</div>
              {p.rows.map((r) => <div key={r} style={{ fontFamily: "ui-monospace, monospace", fontSize: 19 * u, color: "#c9ced8", padding: `${6 * u}px 0`, borderTop: "1px solid #222838", whiteSpace: "pre" }}>{r}</div>)}
            </div>
          );
        })}
      </AbsoluteFill>
      <div style={{ position: "absolute", top: vertical ? H * 0.8 : H * 0.8, width: W, textAlign: "center", fontFamily: FONT, fontSize: 30 * u, color: C.amber, opacity: waiting }}>
        ● Customers waiting
      </div>
    </AbsoluteFill>
  );
};

const Why: React.FC<{ s: any }> = ({ s }) => {
  const t = useT(); const { u } = useDims();
  return (
    <AbsoluteFill>
      <Backdrop glow={C.amber} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 20 * u, fontFamily: FONT }}>
        {s.words.map((w: any) => {
          const a = rise(t, w.at, 0.45);
          return <div key={w.text} style={{ fontSize: 76 * u, fontWeight: 600, color: C.text, opacity: a, transform: `translateX(${(1 - a) * -40}px)`, display: "flex", alignItems: "center", gap: 24 * u }}>
            <span style={{ width: 16 * u, height: 16 * u, borderRadius: 8 * u, background: C.amber, boxShadow: `0 0 18px ${C.amber}` }} />{w.text}</div>;
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Solution: React.FC<{ s: any }> = ({ s }) => {
  const t = useT(); const { u, W } = useDims();
  const a = rise(t, s.name - 0.2, 0.7);
  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", fontFamily: FONT, gap: 34 * u }}>
        <div style={{ display: "flex", alignItems: "center", gap: 28 * u, opacity: a, transform: `scale(${0.92 + 0.08 * a})` }}>
          <Logo size={120 * u} />
          <div style={{ fontSize: 136 * u, fontWeight: 700, letterSpacing: -4 * u, color: C.text }}>Clearline</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 * u, alignItems: "center", maxWidth: W * 0.8 }}>
          {s.promise.map((p: any) => {
            const b = rise(t, p.at, 0.6);
            return <div key={p.text} style={{ fontSize: 40 * u, color: C.muted, textAlign: "center", lineHeight: 1.35, opacity: b, transform: `translateY(${(1 - b) * 16}px)` }}>{p.text}</div>;
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Fit a target rect to the frame's aspect ratio, inside the image. */
function fit(r: Rect, img: [number, number], W: number, H: number): Rect {
  let [x, y, w, h] = r;
  const ar = W / H;
  if (w / h > ar) { const nh = w / ar; y -= (nh - h) / 2; h = nh; } else { const nw = h * ar; x -= (nw - w) / 2; w = nw; }
  if (w > img[0]) { x = (img[0] - w) / 2; } else { x = Math.max(0, Math.min(x, img[0] - w)); }
  if (h > img[1]) { y = (img[1] - h) / 2; } else { y = Math.max(0, Math.min(y, img[1] - h)); }
  return [x, y, w, h];
}
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerpRect = (a: Rect, b: Rect, k: number): Rect => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k), lerp(a[3], b[3], k)];

function camAt(cam: { at: number; rect: Rect }[], t: number, size: [number, number], W: number, H: number): Rect {
  const R = cam.map((c) => fit(c.rect, size, W, H));
  let cur = R[0];
  for (let i = 1; i < cam.length; i++) {
    const k = interpolate(t, [cam[i].at, cam[i].at + 1.1], [0, 1], { ...clamp, easing: ease });
    if (k <= 0) break;
    cur = lerpRect(cur, R[i], k);
  }
  return cur;
}

const Shot: React.FC<{ s: any }> = ({ s }) => {
  const t = useT(); const { W, H, u, vertical } = useDims();
  const size: [number, number] = [3840, Math.max(...s.images.map((i: any) => i.size[1]))];
  const [cx, cy, cw] = camAt(s.cam, t, s.images[0].size, W, H);
  const scale = W / cw;
  const toScreen = (p: [number, number]) => [(p[0] - cx) * scale, (p[1] - cy) * scale];
  // Cursor: eased between keyframes; a press on clicks.
  let cursor: number[] | null = null, press = 0;
  if (s.cursor) {
    const ks = s.cursor; let pos = ks[0].pos;
    for (let i = 1; i < ks.length; i++) { const k = interpolate(t, [ks[i].at - 0.75, ks[i].at], [0, 1], { ...clamp, easing: ease }); if (k <= 0) break; pos = [lerp(pos[0], ks[i].pos[0], k), lerp(pos[1], ks[i].pos[1], k)]; }
    const vis = interpolate(t, [ks[0].at - 0.3, ks[0].at], [0, 1], clamp);
    if (vis > 0) cursor = [...toScreen(pos as [number, number]), vis];
    for (const k of ks.filter((x: any) => x.click)) press = Math.max(press, interpolate(t, [k.at, k.at + 0.12, k.at + 0.5], [0, 1, 0], clamp));
  }
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: size[0], height: size[1], transformOrigin: "0 0", transform: `translate(${-cx * scale}px, ${-cy * scale}px) scale(${scale})` }}>
        {s.images.map((im: any, k: number) => {
          const a = k === 0 ? 1 : interpolate(t, [im.at, im.at + 0.3], [0, 1], clamp);
          return <Img key={im.src} src={staticFile(im.src)} style={{ position: "absolute", left: 0, top: 0, width: im.size[0], height: im.size[1], opacity: a }} />;
        })}
        {(s.ring ?? []).map((r: any, k: number) => {
          const a = interpolate(t, [r.from, r.from + 0.35, r.to - 0.3, r.to], [0, 1, 1, 0], clamp);
          return <div key={k} style={{ position: "absolute", left: r.rect[0] - 14, top: r.rect[1] - 14, width: r.rect[2] + 28, height: r.rect[3] + 28, borderRadius: 26,
            border: `${5 / scale * 2}px solid ${C.accent2}`, boxShadow: `0 0 ${40 / scale}px ${C.accent}`, opacity: a }} />;
        })}
      </div>
      {/* soft vignette so captions and edges read well */}
      <AbsoluteFill style={{ background: "linear-gradient(180deg, #0000 62%, #0a0c11cc 100%)" }} />
      {s.label && (() => {
        const a = interpolate(t, [s.label.from, s.label.from + 0.4, s.label.to - 0.4, s.label.to], [0, 1, 1, 0], clamp);
        return <div style={{ position: "absolute", top: (vertical ? 90 : 40) * u, left: vertical ? 40 * u : 48 * u, fontFamily: FONT, fontSize: 28 * u, color: C.text,
          background: "#11141bdd", border: `1px dashed ${C.faint}`, borderRadius: 999, padding: `${8 * u}px ${20 * u}px`, opacity: a }}>{s.label.text}</div>;
      })()}
      {cursor && (
        <div style={{ position: "absolute", left: cursor[0], top: cursor[1], opacity: cursor[2], transform: `scale(${1 - 0.15 * press})`, transformOrigin: "0 0" }}>
          <div style={{ position: "absolute", left: -30, top: -30, width: 60, height: 60, borderRadius: 30, border: `3px solid ${C.accent2}`, opacity: press, transform: `scale(${0.6 + press})` }} />
          <svg width={38 * u} height={38 * u} viewBox="0 0 24 24" style={{ filter: "drop-shadow(0 4px 8px #000a)" }}>
            <path d="M3 2 L3 19 L8 14.5 L11.5 22 L14.5 20.6 L11 13.5 L18 13.5 Z" fill="#ffffff" stroke="#0a0c11" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
        </div>
      )}
    </AbsoluteFill>
  );
};

const Outcome: React.FC<{ s: any }> = ({ s }) => {
  const t = useT(); const { u, W } = useDims();
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Img src={staticFile(s.bg)} style={{ position: "absolute", width: W, opacity: 0.22, filter: "blur(14px)", transform: "scale(1.08)" }} />
      <Backdrop glow={C.green} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "flex-start", flexDirection: "column", gap: 34 * u, fontFamily: FONT, paddingLeft: W * 0.14, paddingRight: W * 0.08 }}>
        {s.lines.map((l: any) => {
          const a = rise(t, l.at, 0.5);
          return <div key={l.text} style={{ display: "flex", alignItems: "center", gap: 28 * u, opacity: a, transform: `translateY(${(1 - a) * 20}px)` }}>
            <svg width={56 * u} height={56 * u} viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill={`${C.green}22`} stroke={C.green} strokeWidth="1.5" /><path d="M7 12.5 L10.5 16 L17 9" stroke={C.green} strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span style={{ fontSize: 64 * u, fontWeight: 600, color: C.text, letterSpacing: -1 * u }}>{l.text}</span></div>;
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const EndCard: React.FC<{ at?: number }> = ({ at = -10 }) => {
  const t = useT(); const { u, vertical } = useDims();
  const a = rise(t, at - 0.3, 0.8), b = rise(t, at + 1.2, 0.8);
  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", fontFamily: FONT, gap: 26 * u, paddingBottom: vertical ? 0 : 60 * u }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24 * u, opacity: a }}><Logo size={92 * u} /><span style={{ fontSize: 110 * u, fontWeight: 700, letterSpacing: -3 * u, color: C.text }}>Clearline</span></div>
        <div style={{ fontSize: 40 * u, color: C.muted, opacity: a }}>Get paid in stablecoins without the mess.</div>
        <div style={{ marginTop: 20 * u, fontSize: 26 * u, color: C.accent2, border: `1px solid ${C.accent}66`, borderRadius: 999, padding: `${8 * u}px ${22 * u}px`, opacity: b }}>Working demo · seeking early feedback</div>
        <div style={{ marginTop: 26 * u, fontSize: 34 * u, color: C.text, fontWeight: 600, opacity: b }}>Aashmiin Kaur</div>
        <div style={{ fontSize: 24 * u, color: C.muted, opacity: b, textAlign: "center", lineHeight: 1.6 }}>aashmiin@gmail.com{vertical ? <br /> : "  ·  "}linkedin.com/in/aashmiin-kaur-479665391</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const SCENES: Record<string, React.FC<{ s: any }>> = { hook: Hook, problem: Problem, why: Why, solution: Solution, shot: Shot, outcome: Outcome, end: ({ s }) => <EndCard at={s.at} /> };

const Captions: React.FC<{ caps: Timeline["captions"] }> = ({ caps }) => {
  const t = useT(); const { H, W, vertical } = useDims();
  const c = caps.find((x) => t >= x.from && t < x.to);
  if (!c) return null;
  const a = interpolate(t, [c.from, c.from + 0.12], [0, 1], clamp);
  const fs = vertical ? Math.round(W * 0.05) : Math.round(H * 0.04);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: vertical ? H * 0.17 : H * 0.065, display: "flex", justifyContent: "center", opacity: a }}>
      <div style={{ maxWidth: vertical ? W * 0.88 : W * 0.72, fontFamily: FONT, fontSize: fs, fontWeight: 600, lineHeight: 1.25, color: "#ffffff", textAlign: "center",
        background: "#0a0c11c4", borderRadius: fs * 0.45, padding: `${fs * 0.28}px ${fs * 0.6}px`, boxShadow: "0 8px 30px #0008", letterSpacing: -0.2 }}>{c.text}</div>
    </div>
  );
};

export const Film: React.FC<{ timeline: Timeline }> = ({ timeline }) => {
  useFonts();
  const t = useT();
  const fadeIn = interpolate(t, [0, 0.8], [1, 0], clamp);
  const fadeOut = interpolate(t, [timeline.duration - 1.2, timeline.duration], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {timeline.scenes.map((s, k) => {
        if (t < s.from || t > s.to) return null;
        const S = SCENES[s.kind];
        const a = k === 0 ? 1 : interpolate(t, [s.from, s.from + 0.5], [0, 1], { ...clamp, easing: ease });
        return <AbsoluteFill key={k} style={{ opacity: a }}><S s={s} /></AbsoluteFill>;
      })}
      <Captions caps={timeline.captions} />
      <AbsoluteFill style={{ background: "#000", opacity: Math.max(fadeIn, fadeOut) }} />
    </AbsoluteFill>
  );
};

export const Thumbnail: React.FC = () => {
  useFonts();
  const { u } = useDims();
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Img src={staticFile("shots/orbit.png")} style={{ position: "absolute", width: 3840 * 0.62, left: -3840 * 0.62 * 0.13, top: -40, opacity: 0.5 }} />
      <AbsoluteFill style={{ background: `linear-gradient(90deg, ${C.bg} 30%, ${C.bg}cc 55%, ${C.bg}55 100%)` }} />
      <AbsoluteFill style={{ justifyContent: "center", padding: 110 * u, fontFamily: FONT, gap: 26 * u }}>
        <div style={{ display: "flex", alignItems: "center", gap: 22 * u }}><Logo size={84 * u} /><span style={{ fontSize: 96 * u, fontWeight: 700, color: C.text, letterSpacing: -3 * u }}>Clearline</span></div>
        <div style={{ fontSize: 58 * u, fontWeight: 600, color: C.text, maxWidth: 900 * u, lineHeight: 1.15 }}>Every stablecoin payment matched, checked and explained.</div>
        <div style={{ fontSize: 28 * u, color: C.muted }}>Product film · working demo · demo data</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
