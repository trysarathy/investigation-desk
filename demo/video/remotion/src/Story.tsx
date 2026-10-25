// The Clearline film, told through Maya. Driven by the generated timeline (seconds): every beat is
// anchored to the narration. Layout rules: one thing on screen at a time; app shots are single real
// elements shown large (smallest text >= 3% of frame height) over a dimmed copy of their page; a
// fixed caption band at the bottom; scenes dip through black (no overlap, no ghosting).

import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig, continueRender, delayRender } from "remotion";

export interface StoryTimeline {
  fps: number; duration: number; frames: number; cut: string;
  scenes: ({ kind: string; from: number; to: number } & Record<string, any>)[];
  captions: { from: number; to: number; text: string }[];
  lines: any[]; music?: any;
}

const C = { bg: "#07090d", text: "#f2f4f7", muted: "#a3aab6", faint: "#6b7280", accent: "#8ea2ff", accent2: "#b9c6ff", teal: "#5fd0c4",
  amber: "#f2bd63", red: "#ff8a7f", green: "#66d9a3" };
const FONT = "Inter, system-ui, sans-serif";
const MONO = "ui-monospace, 'JetBrains Mono', Menlo, monospace";
const ease = Easing.bezier(0.33, 0, 0.15, 1);
const cl = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const rise = (t: number, at: number, d = 0.5) => interpolate(t, [at, at + d], [0, 1], { ...cl, easing: ease });
const span = (t: number, a: number, b: number, d = 0.3) => Math.min(rise(t, a, d), 1 - rise(t, b - d, d));

function useFonts() {
  const [h] = React.useState(() => delayRender("fonts"));
  React.useEffect(() => {
    const faces = [400, 500, 600, 700].map((w) => new FontFace("Inter", `url(${staticFile(`fonts/inter-latin-${w}-normal.woff2`)})`, { weight: String(w) }));
    Promise.all(faces.map((f) => f.load())).then((l) => { l.forEach((f) => document.fonts.add(f)); continueRender(h); });
  }, [h]);
}
const useT = () => { const f = useCurrentFrame(); const { fps } = useVideoConfig(); return f / fps; };
/** Layout: the content area sits above a fixed caption band. `k` scales sizes designed for 1920x1080. */
function useL() {
  const { width: W, height: H } = useVideoConfig();
  const vertical = H > W;
  const band = vertical ? 330 : 172;
  return { W, H, vertical, band, CH: H - band, k: vertical ? 1 : 1 };
}

// ---------- shared pieces ----------
const Backdrop: React.FC<{ glow?: string; strength?: number }> = ({ glow = C.accent, strength = 0.14 }) => {
  const t = useT(); const { W, CH } = useL();
  const a = Math.round(strength * 255).toString(16).padStart(2, "0");
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse 70% 60% at ${50 + 6 * Math.sin(t / 7)}% ${42 + 5 * Math.cos(t / 8)}%, ${glow}${a} 0%, ${C.bg} 70%)` }}>
      <svg width={W} height={CH} style={{ position: "absolute", opacity: 0.5 }}>
        <defs><pattern id="dots" width="40" height="40" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#ffffff" opacity="0.05" /></pattern></defs>
        <rect width="100%" height="100%" fill="url(#dots)" />
      </svg>
    </AbsoluteFill>
  );
};
const Logo: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 64 64">
    <defs><linearGradient id="lg2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={C.accent2} /><stop offset="1" stopColor={C.accent} /></linearGradient></defs>
    <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#lg2)" />
    <path d="M14 34 H26 L31 40 L48 22" stroke={C.bg} strokeWidth="5.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Content: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => {
  const { W, CH } = useL();
  return <div style={{ position: "absolute", left: 0, top: 0, width: W, height: CH, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, ...style }}>{children}</div>;
};
const ViewLabel: React.FC<{ text: string; a: number }> = ({ text, a }) => {
  const { vertical } = useL();
  const col = text.startsWith("Customer") ? C.teal : C.accent2;
  return <div style={{ position: "absolute", top: vertical ? 70 : 44, left: vertical ? 50 : 60, display: "flex", alignItems: "center", gap: 14, opacity: a, fontFamily: FONT,
    fontSize: 34, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase", color: col }}>
    <span style={{ width: 14, height: 14, borderRadius: 7, background: col, boxShadow: `0 0 16px ${col}` }} />{text}</div>;
};

// ---------- scenes ----------
const Hook: React.FC<{ s: any }> = ({ s }) => {
  const t = useT(); const { W, CH } = useL();
  const [b1, b2] = s.beats;
  const w1 = span(t, b1, b2 - 0.1, 0.4), w2 = rise(t, b2 + 0.15, 0.5);
  const stall = rise(t, b2 - 0.2, 1.4);
  const p = ((t - b1 + 0.3) * 1.5) % 1.3;
  const x = stall > 0 ? interpolate(stall, [0, 1], [W * 0.2, W * 0.52]) : interpolate(p, [0, 1.3], [-W * 0.3, W * 1.1]);
  const col = stall > 0.6 ? C.amber : C.accent2;
  return (
    <AbsoluteFill>
      <Backdrop glow={stall > 0.5 ? C.amber : C.accent} />
      <div style={{ position: "absolute", top: CH * 0.66, left: 0, width: W, height: 2, background: "#ffffff12" }} />
      <div style={{ position: "absolute", top: CH * 0.66 - 2, left: x - W * 0.22, width: W * 0.22, height: 6, borderRadius: 3, background: `linear-gradient(90deg, transparent, ${col})`, boxShadow: `0 0 26px ${col}` }} />
      <Content>
        <div style={{ position: "absolute", fontSize: 168, fontWeight: 600, letterSpacing: -6, color: C.text, opacity: w1, transform: `translateY(${(1 - w1) * 24}px)` }}>Seconds.</div>
        <div style={{ position: "absolute", fontSize: 168, fontWeight: 600, letterSpacing: -6, color: C.amber, opacity: w2, transform: `translateY(${(1 - w2) * 24}px)` }}>Hours.</div>
      </Content>
    </AbsoluteFill>
  );
};

const Maya: React.FC<{ s: any }> = ({ s }) => {
  const t = useT(); const a = rise(t, s.at - 0.2, 0.7), b = rise(t, s.at + 0.6, 0.6), c = rise(t, s.at + 1.6, 0.6);
  return (
    <AbsoluteFill>
      <Backdrop />
      <Content style={{ flexDirection: "column", gap: 26 }}>
        <div style={{ width: 200, height: 200, borderRadius: 100, opacity: a, transform: `scale(${0.9 + 0.1 * a})`, background: "linear-gradient(145deg,#2a3150,#161a28)",
          border: "2px solid #3a4266", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 96, fontWeight: 600, color: C.accent2, boxShadow: "0 30px 80px #0008" }}>M</div>
        <div style={{ fontSize: 110, fontWeight: 700, color: C.text, letterSpacing: -3, opacity: a }}>Maya</div>
        <div style={{ fontSize: 48, color: C.muted, opacity: b }}>Finance manager · Singapore</div>
        <div style={{ fontSize: 34, color: C.faint, opacity: c, border: "1px solid #2b3140", borderRadius: 999, padding: "6px 22px" }}>A fictional story</div>
      </Content>
    </AbsoluteFill>
  );
};

const Inbox: React.FC<{ s: any }> = ({ s }) => {
  const t = useT(); const { vertical } = useL();
  const unread = Math.min(14, Math.max(0, Math.floor((t - s.at) * 5)));
  return (
    <AbsoluteFill>
      <Backdrop glow={C.amber} strength={0.1} />
      <Content style={{ flexDirection: "column", gap: 24, alignItems: "stretch", padding: vertical ? "0 50px" : "0 300px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 36, color: C.muted, opacity: rise(t, s.at - 0.3, 0.4) }}>
          <span>Maya's inbox</span><span style={{ color: C.amber, fontWeight: 600 }}>{unread > 0 ? `${unread} unread` : ""}</span></div>
        {s.msgs.map((m: any, k: number) => {
          const a = rise(t, s.at + k * 0.55, 0.45);
          return <div key={k} style={{ opacity: a, transform: `translateY(${(1 - a) * 30}px)`, background: "#121621", border: "1px solid #252b3a", borderRadius: 22, padding: "22px 30px", boxShadow: "0 20px 50px #0007" }}>
            <div style={{ fontSize: 34, color: C.muted, marginBottom: 6 }}>{m.from}</div>
            <div style={{ fontSize: 44, color: C.text, lineHeight: 1.25 }}>{m.text}</div></div>;
        })}
      </Content>
    </AbsoluteFill>
  );
};

const Clock: React.FC<{ size: number; speed?: number; t0: number; color?: string }> = ({ size, speed = 6, t0, color = C.amber }) => {
  const t = useT(); const ang = (t - t0) * speed * 30;
  return <svg width={size} height={size} viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="44" fill="none" stroke={color} strokeWidth="3" opacity="0.9" />
    {[...Array(12)].map((_, i) => <line key={i} x1="50" y1="10" x2="50" y2="15" stroke={color} strokeWidth="2" transform={`rotate(${i * 30} 50 50)`} opacity="0.6" />)}
    <line x1="50" y1="50" x2="50" y2="28" stroke={color} strokeWidth="4" strokeLinecap="round" transform={`rotate(${ang / 12} 50 50)`} />
    <line x1="50" y1="50" x2="50" y2="18" stroke={color} strokeWidth="2.5" strokeLinecap="round" transform={`rotate(${ang} 50 50)`} />
  </svg>;
};

const Dig: React.FC<{ s: any }> = ({ s }) => {
  const t = useT(); const { vertical } = useL();
  const wins = [
    { title: "Pages of codes", body: ["0x9f3a…c21e", "0x00b7…4e90", "0x7d12…a8f3"], mono: true },
    { title: "Spreadsheets", grid: true },
    { title: "Email chains", body: ["Re: Re: payment?", "Re: which wallet?", "Re: still checking"] },
  ];
  return (
    <AbsoluteFill>
      <Backdrop glow={C.amber} strength={0.1} />
      <Content style={{ flexDirection: vertical ? "column" : "row", gap: 30 }}>
        {wins.map((w, k) => {
          const a = rise(t, s.beats[k], 0.45);
          return <div key={w.title} style={{ opacity: a, transform: `translateY(${(1 - a) * 40}px) rotate(${(k - 1) * 2}deg)`, width: vertical ? 820 : 520, minHeight: 330,
            background: "#11151f", border: "1px solid #283041", borderRadius: 20, padding: 28, boxShadow: "0 40px 90px #000a" }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>{[0, 1, 2].map((d) => <span key={d} style={{ width: 12, height: 12, borderRadius: 6, background: "#2f3747" }} />)}</div>
            <div style={{ fontSize: 38, fontWeight: 600, color: C.text, marginBottom: 16 }}>{w.title}</div>
            {w.grid ? <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              {[...Array(9)].map((_, i) => <div key={i} style={{ height: 52, borderRadius: 8, background: "#1a2030", color: C.amber, fontSize: 36, display: "flex", alignItems: "center", justifyContent: "center" }}>{i % 3 === 2 ? "?" : ""}</div>)}</div>
              : w.body!.map((b) => <div key={b} style={{ fontSize: 34, fontFamily: w.mono ? MONO : FONT, color: C.muted, padding: "8px 0", borderTop: "1px solid #222a39" }}>{b}</div>)}
          </div>;
        })}
      </Content>
      <div style={{ position: "absolute", right: vertical ? 60 : 90, top: vertical ? 80 : 60, opacity: rise(t, s.beats[3] - 0.6, 0.5) }}><Clock size={150} t0={s.beats[3] - 0.6} /></div>
    </AbsoluteFill>
  );
};

/** A premium, serious banknote: fine line-work, a magnifying glass passing over, three doubts. */
const Note: React.FC<{ w: number; stamp?: boolean; notch?: boolean }> = ({ w, stamp, notch }) => {
  const h = w * 0.5;
  return <svg width={w} height={h} viewBox="0 0 400 200">
    <defs><clipPath id={`nc${notch ? 1 : 0}${stamp ? 1 : 0}`}>
      <path d={notch ? "M8 8 H392 V140 L330 192 H8 Z" : "M8 8 H392 V192 H8 Z"} /></clipPath></defs>
    <g clipPath={`url(#nc${notch ? 1 : 0}${stamp ? 1 : 0})`}>
      <rect x="8" y="8" width="384" height="184" rx="14" fill="#141a24" stroke="#c9d1df" strokeOpacity="0.55" strokeWidth="2" />
      <rect x="22" y="22" width="356" height="156" rx="10" fill="none" stroke="#c9d1df" strokeOpacity="0.25" />
      {[...Array(9)].map((_, i) => <ellipse key={i} cx="200" cy="100" rx={30 + i * 9} ry={22 + i * 6} fill="none" stroke="#c9d1df" strokeOpacity={0.14} />)}
      {!stamp && <text x="200" y="118" textAnchor="middle" fontFamily="Inter" fontWeight="600" fontSize="54" fill="#dfe5ef" opacity="0.85">$100</text>}
      {w >= 600 && <text x="40" y="58" fontFamily="Inter" fontSize="20" fill="#c9d1df" opacity="0.5">DIGITAL DOLLAR</text>}
    </g>
    {notch && <path d="M392 140 L330 192 H392 Z" fill="none" stroke={C.amber} strokeWidth="3" strokeDasharray="8 6" />}
    {stamp && <g transform="rotate(-14 200 100)"><rect x="110" y="60" width="180" height="80" rx="10" fill="none" stroke={C.red} strokeWidth="6" />
      <text x="200" y="120" textAnchor="middle" fontFamily="Inter" fontWeight="700" fontSize="56" fill={C.red}>FAKE</text></g>}
  </svg>;
};

const Cashier: React.FC<{ s: any }> = ({ s }) => {
  const t = useT(); const { vertical } = useL();
  const end = s.every ?? s.to;
  const note = span(t, s.from + 0.1, end, 0.4);
  const sweep = interpolate(t, [s.from + 0.6, s.tags[2] + 0.6], [-1, 1], cl);
  const labels = ["Real?", "Short?", "Whose?"];
  const ev = s.every ? rise(t, s.every, 0.5) : 0;
  return (
    <AbsoluteFill>
      <Backdrop strength={0.1} />
      <Content style={{ flexDirection: "column", gap: 40 }}>
        <div style={{ position: "relative", opacity: note }}>
          <Note w={vertical ? 860 : 820} />
          <svg width="230" height="230" viewBox="0 0 100 100" style={{ position: "absolute", left: `calc(50% + ${sweep * 300}px - 115px)`, top: 40 + Math.sin(t * 2) * 6 }}>
            <circle cx="42" cy="42" r="30" fill="#ffffff0d" stroke="#e6ebf2" strokeWidth="3.5" /><line x1="64" y1="64" x2="92" y2="92" stroke="#e6ebf2" strokeWidth="7" strokeLinecap="round" />
          </svg>
        </div>
        <div style={{ display: "flex", gap: 30, opacity: note }}>
          {labels.map((l, k) => { const a = rise(t, s.tags[k], 0.35);
            return <div key={l} style={{ opacity: a, transform: `scale(${0.85 + 0.15 * a})`, fontSize: 52, fontWeight: 600, color: C.amber, border: `2px solid ${C.amber}55`, borderRadius: 999, padding: "8px 34px" }}>{l}</div>; })}
        </div>
      </Content>
      {s.every && <Content style={{ flexDirection: "column", gap: 30, opacity: ev }}><Clock size={220} speed={9} t0={s.every} /><div style={{ fontSize: 76, fontWeight: 600, color: C.text }}>Every afternoon.</div></Content>}
    </AbsoluteFill>
  );
};

const Icon: React.FC<{ k: number; t0: number }> = ({ k, t0 }) => {
  const t = useT(); const a = rise(t, t0, 0.6);
  if (k === 0) return <Note w={300} notch />;
  if (k === 2) return <Note w={300} stamp />;
  if (k === 1) {
    const d = interpolate(a, [0, 1], [0, 1]);
    return <svg width="300" height="150" viewBox="0 0 300 150">
      <path d="M10 120 L150 120" stroke="#c9d1df" strokeOpacity="0.5" strokeWidth="14" strokeLinecap="round" />
      <path d="M150 120 L290 120" stroke="#c9d1df" strokeOpacity="0.5" strokeWidth="14" strokeLinecap="round" />
      <path d="M150 120 L270 30" stroke={C.red} strokeOpacity="0.8" strokeWidth="14" strokeLinecap="round" />
      <text x="262" y="102" fontFamily="Inter" fontWeight="700" fontSize="40" fill={C.green}>✓</text>
      <circle cx={d < 0.5 ? 10 + d * 280 : 150 + (d - 0.5) * 2 * 120} cy={d < 0.5 ? 120 : 120 - (d - 0.5) * 2 * 90} r="14" fill={C.amber} />
      {d > 0.95 && <text x="236" y="40" fontFamily="Inter" fontWeight="700" fontSize="44" fill={C.red}>✕</text>}
    </svg>;
  }
  return <svg width="300" height="170" viewBox="0 0 300 170">
    <rect x="40" y="20" width="220" height="130" rx="12" fill="#141a24" stroke="#c9d1df" strokeOpacity="0.55" strokeWidth="2" />
    <path d="M40 30 L150 100 L260 30" fill="none" stroke="#c9d1df" strokeOpacity="0.45" strokeWidth="2" />
    <rect x="170" y="108" width="74" height="30" rx="6" fill="none" stroke={C.amber} strokeDasharray="6 5" strokeWidth="2" />
    <text x="207" y="136" textAnchor="middle" fontFamily="Inter" fontWeight="700" fontSize="38" fill={C.amber}>?</text>
  </svg>;
};

const Wrong: React.FC<{ s: any }> = ({ s }) => {
  const t = useT(); const { vertical } = useL();
  const labels = ["Paid too little", "Sent down the wrong road", "Counterfeit digital dollars", "No name, no invoice"];
  return (
    <AbsoluteFill>
      <Backdrop glow={C.red} strength={0.08} />
      <Content style={{ flexDirection: "column", gap: 34 }}>
        <div style={{ fontSize: 44, color: C.muted, opacity: rise(t, s.title - 0.2, 0.4) }}>What goes wrong</div>
        <div style={{ display: "grid", gridTemplateColumns: vertical ? "1fr" : "1fr 1fr", gap: vertical ? 24 : "26px 60px" }}>
          {s.items.map((at: number, k: number) => { const a = rise(t, at - 0.15, 0.45);
            return <div key={k} style={{ opacity: a, transform: `translateY(${(1 - a) * 24}px)`, display: "flex", alignItems: "center", gap: 26, width: vertical ? 960 : 800,
              background: "#10141d", border: "1px solid #232a38", borderRadius: 22, padding: "18px 26px" }}>
              <div style={{ width: 300, height: 170, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><div style={{ transform: "scale(0.92)" }}><Icon k={k} t0={at} /></div></div>
              <div style={{ fontSize: 42, fontWeight: 600, color: C.text, lineHeight: 1.2 }}>{labels[k]}</div></div>; })}
        </div>
      </Content>
    </AbsoluteFill>
  );
};

const Turn: React.FC<{ s: any }> = ({ s }) => {
  const t = useT(); const { vertical } = useL();
  const q = s.question != null ? span(t, s.question - 0.2, s.name - 0.25, 0.4) : 0;
  const n = rise(t, s.name - 0.1, 0.8), g = rise(t, s.tagline, 0.7);
  return (
    <AbsoluteFill>
      <Backdrop strength={0.08 + 0.18 * n} />
      <Content><div style={{ fontSize: vertical ? 84 : 92, fontWeight: 600, color: C.text, textAlign: "center", maxWidth: vertical ? 950 : 1500, lineHeight: 1.15, letterSpacing: -2, opacity: q }}>What if every payment explained itself?</div></Content>
      <Content style={{ flexDirection: "column", gap: 34 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 32, opacity: n, transform: `scale(${0.9 + 0.1 * n})`, filter: `blur(${(1 - n) * 8}px)` }}>
          <Logo size={vertical ? 130 : 150} /><span style={{ fontSize: vertical ? 140 : 170, fontWeight: 700, letterSpacing: -5, color: C.text }}>Clearline</span></div>
        <div style={{ fontSize: vertical ? 50 : 56, color: C.accent2, opacity: g, transform: `translateY(${(1 - g) * 14}px)`, textAlign: "center", maxWidth: 1400 }}>Get paid in digital dollars without the detective work.</div>
      </Content>
    </AbsoluteFill>
  );
};

const Chapter: React.FC<{ n: string; title: string; a: number }> = ({ n, title, a }) => (
  <Content style={{ flexDirection: "column", gap: 18, opacity: a }}>
    <div style={{ fontSize: 40, fontWeight: 600, color: C.accent2, letterSpacing: 4 }}>{n}</div>
    <div style={{ fontSize: 96, fontWeight: 700, color: C.text, letterSpacing: -3, textAlign: "center" }}>{title}</div>
  </Content>
);
const Start: React.FC<{ s: any }> = ({ s }) => { const t = useT(); return <AbsoluteFill><Backdrop /><Chapter n="01" title="Before anyone pays" a={rise(t, s.from + 0.1, 0.6)} /></AbsoluteFill>; };

// Page backgrounds are pre-blurred (build_story.py writes *_soft.jpg): a live CSS blur over a full-frame
// image is what made the headless browser drop tiles on some frames.
const soft = (src: string) => src.replace(/\.png$/, "_soft.jpg");

/** One real app element, large, over a dimmed copy of its page. */
const Element: React.FC<{ e: any; a: number; red?: boolean; tick?: number }> = ({ e, a, red, tick = 0 }) => {
  const { W, CH, vertical } = useL();
  const maxW = vertical ? W - 80 : W - 220, maxH = CH - 260;
  // As large as the stage allows, up to the capture's native sharpness (3x), never below the 3%-text scale.
  const fit = Math.min(maxW / e.css[0], maxH / e.css[1]);
  const s = Math.max(Math.min(e.scale, fit), Math.min(3.0, fit));
  const w = e.css[0] * s, h = e.css[1] * s;
  const glow = red ? C.red : C.accent;
  return <div style={{ position: "relative", width: w, height: h, opacity: a, transform: `scale(${0.96 + 0.04 * a})`, borderRadius: 18, overflow: "visible" }}>
    <Img src={staticFile(e.src)} style={{ width: w, height: h, borderRadius: 14, boxShadow: `0 0 0 2px ${glow}55, 0 30px 100px #000c, 0 0 60px ${glow}22` }} />
    {tick > 0 && <div style={{ position: "absolute", right: -48, top: h / 2 - 48, width: 96, height: 96, borderRadius: 48, background: C.green, display: "flex", alignItems: "center", justifyContent: "center",
      transform: `scale(${tick})`, boxShadow: `0 0 40px ${C.green}` }}><svg width="56" height="56" viewBox="0 0 24 24"><path d="M5 12.5 L10 17 L19 7" stroke={C.bg} strokeWidth="3.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg></div>}
  </div>;
};

const Focus: React.FC<{ s: any }> = ({ s }) => {
  const t = useT(); const { W, CH } = useL();
  const items = s.items;
  const chapter = s.chapter;
  const shift = chapter ? 1.3 : 0;
  const at = (k: number) => items[k].at + (k === 0 ? shift : 0);
  const cur = Math.max(0, items.findIndex((_: any, k: number) => k + 1 === items.length || t < at(k + 1)));
  const it = items[cur];
  const a = s.hold && cur === 0 ? 1 : Math.min(rise(t, at(cur) - 0.05, 0.4), cur + 1 < items.length ? 1 - rise(t, at(cur + 1) - 0.3, 0.25) : 1);
  const view = it.view ?? s.view;
  const bg = it.bg ?? s.bg;
  const tick = it.tick ? rise(t, at(cur) + 0.35, 0.35) : 0;
  const ch = chapter ? span(t, s.from + 0.1, at(0) - 0.05, 0.35) : 0;
  const elA = chapter ? rise(t, at(0) - 0.05, 0.4) : 1;
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Img src={staticFile(soft(bg))} style={{ position: "absolute", width: W, height: CH, objectFit: "cover", opacity: 0.16, transform: "scale(1.06)" }} />
      <Backdrop strength={0.06} />
      {chapter && <Chapter n={chapter[0]} title={chapter[1]} a={ch} />}
      <div style={{ opacity: elA }}>
        <ViewLabel text={view} a={elA} />
        <Content style={{ flexDirection: "column", gap: 36 }}>
          <Element e={it.el} a={a} red={it.red} tick={tick} />
          {it.note && <div style={{ fontSize: 46, fontWeight: 600, color: it.red ? C.red : it.tick ? C.green : C.accent2, opacity: rise(t, at(cur) + 0.25, 0.4) * a }}>{it.note}</div>}
        </Content>
      </div>
    </AbsoluteFill>
  );
};

const Compare: React.FC<{ s: any }> = ({ s }) => {
  const t = useT(); const { vertical } = useL();
  const real: string = s.real, fake: string = s.fake;
  const row = (label: string, addr: string, k: number, bad: boolean) => {
    const a = rise(t, s.at + k * 0.9, 0.45);
    const mid = rise(t, s.at + 2.4, 0.5);
    return <div style={{ opacity: a, display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
      <div style={{ fontSize: 36, color: C.muted }}>{label}</div>
      <div style={{ fontFamily: MONO, fontSize: vertical ? 54 : 72, letterSpacing: 2, color: C.text, display: "flex", gap: 18, alignItems: "baseline" }}>
        <span style={{ color: C.accent2, background: "#8ea2ff22", borderRadius: 10, padding: "0 10px" }}>{addr.slice(0, 6)}</span>
        <span style={{ color: bad ? C.red : C.faint, opacity: 0.35 + 0.65 * mid, fontSize: vertical ? 44 : 56 }}>{addr.slice(6, 10)}…{addr.slice(-8, -4)}</span>
        <span style={{ color: C.accent2, background: "#8ea2ff22", borderRadius: 10, padding: "0 10px" }}>{addr.slice(-4)}</span>
      </div></div>;
  };
  const verdict = rise(t, s.at + 3.0, 0.5);
  const toWarn = rise(t, s.warn - 0.3, 0.35);
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Img src={staticFile(soft("el/c_bg.png"))} style={{ position: "absolute", width: "100%", height: useL().CH, objectFit: "cover", opacity: 0.12 }} />
      <Backdrop strength={0.06} />
      <ViewLabel text="Customer's view" a={1} />
      <Content style={{ flexDirection: "column", gap: 44, opacity: 1 - toWarn }}>
        {row("Maya's account number", real, 0, false)}
        {row("Pasted from the customer's history", fake, 1, true)}
        <div style={{ fontSize: 54, fontWeight: 600, color: C.amber, opacity: verdict }}>Looks the same… but isn't.</div>
      </Content>
      <Content style={{ flexDirection: "column", gap: 36, opacity: toWarn }}>
        <Element e={s.stop} a={toWarn} red />
        <div style={{ fontSize: 46, fontWeight: 600, color: C.red, opacity: rise(t, s.warn + 0.2, 0.4) }}>Warned before the money moves</div>
      </Content>
    </AbsoluteFill>
  );
};

const Outcome: React.FC<{ s: any }> = ({ s }) => {
  const t = useT(); const { vertical } = useL();
  const close = rise(t, s.laptop + 0.3, 1.4);
  const laptop = 1 - rise(t, s.lines[0].at - 0.5, 0.4);   // the laptop gives way to the three lines
  return (
    <AbsoluteFill>
      <Backdrop glow={close > 0.5 ? C.amber : C.accent} strength={0.08 + 0.1 * close} />
      <Content style={{ opacity: laptop }}>
        <svg width="560" height="380" viewBox="0 0 280 190">
          <g transform={`translate(140 150) scale(1 ${1 - 0.92 * close}) translate(-140 -150)`}>
            <rect x="40" y="20" width="200" height="130" rx="10" fill="#141a24" stroke="#c9d1df" strokeOpacity="0.6" strokeWidth="2" />
            <rect x="52" y="32" width="176" height="106" rx="4" fill={`rgba(142,162,255,${0.25 * (1 - close)})`} />
          </g>
          <path d="M18 152 H262 L248 166 H32 Z" fill="#1b2230" stroke="#c9d1df" strokeOpacity="0.6" strokeWidth="2" />
        </svg>
      </Content>
      <Content style={{ flexDirection: "column", alignItems: vertical ? "flex-start" : "flex-start", gap: 40, padding: vertical ? "0 60px" : "0 300px", justifyContent: "center" }}>
        {s.lines.map((l: any) => { const a = rise(t, l.at - 0.1, 0.5);
          return <div key={l.text} style={{ display: "flex", alignItems: "center", gap: 30, opacity: a, transform: `translateY(${(1 - a) * 18}px)` }}>
            <svg width="70" height="70" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill={`${C.green}22`} stroke={C.green} strokeWidth="1.4" /><path d="M7 12.5 L10.5 16 L17 9" stroke={C.green} strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span style={{ fontSize: vertical ? 58 : 70, fontWeight: 600, color: C.text, letterSpacing: -1 }}>{l.text}</span></div>; })}
      </Content>
    </AbsoluteFill>
  );
};

export const End: React.FC<{ s: any }> = ({ s }) => {
  const t = useT(); const { vertical } = useL();
  const a = rise(t, s.at - 0.3, 0.8), b = rise(t, s.at + 1.0, 0.8);
  return (
    <AbsoluteFill>
      <Backdrop strength={0.16} />
      <Content style={{ flexDirection: "column", gap: 30 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 28, opacity: a }}><Logo size={vertical ? 120 : 130} /><span style={{ fontSize: vertical ? 130 : 150, fontWeight: 700, letterSpacing: -5, color: C.text }}>Clearline</span></div>
        <div style={{ fontSize: 54, color: C.accent2, opacity: a, textAlign: "center", maxWidth: vertical ? 960 : 1600 }}>Get paid in digital dollars without the detective work.</div>
        <div style={{ marginTop: 14, fontSize: 40, color: C.text, border: `1px solid ${C.accent}88`, borderRadius: 999, padding: "8px 30px", opacity: b }}>Working demo · seeking early feedback</div>
        <div style={{ marginTop: 18, fontSize: 52, fontWeight: 600, color: C.text, opacity: b }}>Aashmiin Kaur</div>
        <div style={{ fontSize: 36, color: C.muted, opacity: b, textAlign: "center", lineHeight: 1.5 }}>aashmiin@gmail.com{vertical ? <br /> : "   ·   "}linkedin.com/in/aashmiin-kaur-479665391</div>
      </Content>
    </AbsoluteFill>
  );
};

const SCENES: Record<string, React.FC<{ s: any }>> = { hook: Hook, maya: Maya, inbox: Inbox, dig: Dig, cashier: Cashier, wrong: Wrong, turn: Turn, start: Start,
  focus: Focus, compare: Compare, outcome: Outcome, end: End };

const CaptionBand: React.FC<{ caps: StoryTimeline["captions"] }> = ({ caps }) => {
  const t = useT(); const { W, H, band, vertical } = useL();
  const c = caps.find((x) => t >= x.from && t < x.to);
  const a = c ? 1 : 0;   // captions cut cleanly from one to the next (a fade reads as a blink between captions)
  const fs = vertical ? 58 : 46;
  return (
    <div style={{ position: "absolute", left: 0, top: H - band, width: W, height: band, background: "linear-gradient(180deg, #07090d00 0%, #07090df2 22%, #07090d 100%)",
      display: "flex", alignItems: "center", justifyContent: "center" }}>
      {c && <div style={{ opacity: a, fontFamily: FONT, fontSize: fs, fontWeight: 600, color: "#fff", textAlign: "center", maxWidth: vertical ? W - 80 : W * 0.8, lineHeight: 1.25, paddingTop: vertical ? 0 : 18 }}>{c.text}</div>}
    </div>
  );
};

const DemoBadge: React.FC<{ win?: [number, number] }> = ({ win }) => {
  const t = useT(); const { vertical } = useL();
  if (!win) return null;
  const a = span(t, win[0], win[1], 0.4);
  return <div style={{ position: "absolute", top: vertical ? 70 : 44, right: vertical ? 50 : 60, opacity: a, fontFamily: FONT, fontSize: 34, color: C.muted,
    border: `1px dashed ${C.faint}`, borderRadius: 999, padding: "6px 18px", background: "#0b0e14cc" }}>Demo data · fictional company</div>;
};

export const Story: React.FC<{ timeline: StoryTimeline }> = ({ timeline }) => {
  useFonts();
  const t = useT();
  const fadeOut = interpolate(t, [timeline.duration - 1.2, timeline.duration], [0, 1], cl);
  const fadeIn = interpolate(t, [0, 0.25], [1, 0], cl);
  const s = timeline.scenes.find((x) => t >= x.from && t < x.to) ?? timeline.scenes[timeline.scenes.length - 1];
  const S = SCENES[s.kind];
  const k = timeline.scenes.indexOf(s);
  // Dip through black between scenes: fade out the last 0.3 s, fade in the first 0.3 s. Never two scenes at once.
  const vis = k === 0 ? 1 - interpolate(t, [s.to - 0.3, s.to], [0, 1], cl)
    : Math.min(interpolate(t, [s.from, s.from + 0.3], [0, 1], cl), k === timeline.scenes.length - 1 ? 1 : 1 - interpolate(t, [s.to - 0.3, s.to], [0, 1], cl));
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill style={{ opacity: vis }}><S s={s} /></AbsoluteFill>
      <DemoBadge win={s.demoLabel} />
      <CaptionBand caps={timeline.captions} />
      <AbsoluteFill style={{ background: "#000", opacity: Math.max(fadeIn, fadeOut), pointerEvents: "none" }} />
    </AbsoluteFill>
  );
};

export const StoryThumb: React.FC = () => {
  useFonts();
  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily: FONT }}>
      <Backdrop strength={0.2} />
      <AbsoluteFill style={{ justifyContent: "center", padding: "0 120px", gap: 30 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 26 }}><Logo size={110} /><span style={{ fontSize: 130, fontWeight: 700, color: C.text, letterSpacing: -4 }}>Clearline</span></div>
        <div style={{ fontSize: 70, fontWeight: 600, color: C.text, maxWidth: 1100, lineHeight: 1.12, letterSpacing: -1.5 }}>Get paid in digital dollars without the detective work.</div>
        <div style={{ fontSize: 36, color: C.muted }}>A 2-minute film · working demo</div>
      </AbsoluteFill>
      <div style={{ position: "absolute", right: 120, top: 250, transform: "rotate(-6deg)", opacity: 0.9 }}><Note w={520} stamp /></div>
    </AbsoluteFill>
  );
};
