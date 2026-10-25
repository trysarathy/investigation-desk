// Records a real walkthrough of the app in demo mode, paced by the narration, for the live demo video.
// The page is recorded at 2x (CDP screencast), and every focus point, cursor move, click and scene cut is
// logged so the edit can zoom on one element at a time and draw a smooth cursor.
//
//   node record.cjs <work_dir> <plan: full|short> [base_url]
//   reads  <work_dir>/vo/NN.wav (line durations)
//   writes <work_dir>/<plan>/frames/*.jpg, <work_dir>/<plan>/rec.json
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");

const [W, PLAN, BASE = "http://localhost:3300"] = process.argv.slice(2);
const OUT = path.join(W, PLAN); fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(path.join(OUT, "frames"), { recursive: true });
const dur = (i) => {   // seconds of audio: the "data" chunk's size / byte rate (ffmpeg adds a LIST chunk, so search for it)
  const b = fs.readFileSync(path.join(W, `vo/${String(i).padStart(2, "0")}.wav`)); let o = 12;
  while (o < b.length) { const id = b.toString("ascii", o, o + 4), sz = b.readUInt32LE(o + 4); if (id === "data") return sz / b.readUInt32LE(28); o += 8 + sz + (sz % 2); }
  throw new Error("no data chunk");
};
// The page is laid out at 1440x810 and drawn at 2x: a 2880x1620 window with the page zoomed 2x (the
// screencast ignores deviceScaleFactor). A 2-px pixel that never stops changing keeps frames coming, so the
// recording never holds a half-drawn frame. All coordinates below are in the 2880x1620 window.
const HIDE = `html { zoom: 2 } body::after { content: ""; position: fixed; left: 0; top: 0; width: 2px; height: 2px; z-index: 99999;
  animation: kick .1s steps(2) infinite } @keyframes kick { from { background: #0d0f14 } to { background: #0e1015 } }
  .demo-badge, .workspace .badge, .mode-note, .sidebar-foot, [data-testid=reload-demo], [data-testid=demo-tools] { display: none !important; }
  .page-head .badge:last-child { display: none !important; }`;

// Lines spoken in each version (indices into lines.json). The 60-second cut keeps the four moments.
const LINES = { full: [...Array(16).keys()], short: [3, 6, 8, 9, 11, 12, 14, 15] }[PLAN];
const HOLD = PLAN === "full" ? 1 : 0.4;   // the 60-second cut keeps the same beats with shorter holds
const GAP = PLAN === "full" ? 0.45 : 0.3;

// The walkthrough. Each scene opens a page (under a dip to black); each line's beats run at offsets (s)
// from the line's start. focus = the one element the camera frames; move/click/type drive the cursor.
const SCENES = [
  { open: "/requests", view: "Maya's view", lines: {
      0: [{ at: 0, focus: "viewport" }],
      1: [{ at: 0.4, focus: { text: "Paid automatically", minW: 180, minH: 90 } }, { at: 0.6, move: { text: "Paid automatically", minW: 180, minH: 90 } }],
      2: [{ at: 0, focus: { all: "[data-testid=attention-item]", first: 3, pad: 8, maxW: 1400 } }, { at: 0.3, move: "[data-testid=attention-item] >> nth=0" }] } },
  { open: "pay", view: "Customer's view", chapter: "Before anyone pays: the customer's payment page", lines: {
      3: [{ at: 0, focus: ".pay-top" }],
      4: [{ at: 0, focus: { all: ".pay-steps > li", first: 2 } }, { at: 3.3, focus: ".pay-steps > li >> nth=2" }, { at: 3.5, move: ".pay-steps > li >> nth=2" }],
      5: [{ at: 0, focus: ".pay-check" }, { at: 0.5, move: "[data-testid=check-input]" }],
      6: [{ at: 0, focus: ".pay-check" }, { at: 0, move: "[data-testid=demo-paste-lookalike]" }, { at: 0.8, click: "[data-testid=demo-paste-lookalike]" },
          { at: 1.6, focus: "[data-testid=check-result]", red: true }], hold: { 6: 3.2 } } },
  { open: "/requests/DEMO-1041", view: "Maya's view", chapter: "When the payment is right", lines: {
      7: [{ at: 0, focus: { all: ".page-head h1", pad: 10 } }, { at: -1.4, move: "[data-testid=play-payment]" }, { at: -0.4, click: "[data-testid=play-payment]" }],
      8: [{ at: 0, focus: { all: ".page-head h1", pad: 10 } }, { at: 2.8, focus: { all: "[data-testid=verdict] h2, [data-testid=verdict] ul", pad: 10, maxW: 1300 }, tick: true }] }, hold: { 8: 1.0 } },
  { open: "/requests/DEMO-1043", view: "Maya's view", chapter: "When something's wrong: fake digital dollars", lines: {
      9: [{ at: 0, focus: { text: "Email from", minW: 400 } }, { at: 2.2, focus: { all: "[data-testid=verdict] h2", pad: 14 }, red: true }],
      10: [{ at: 0, focus: { all: "[data-testid=verdict] h2, [data-testid=verdict] ul", pad: 10, maxW: 1500 }, red: true }],
      11: [{ at: 0, focus: { all: "[data-testid=mark-paid-blocked]", pad: 60 }, red: true }, { at: 0.2, move: "[data-testid=mark-paid-blocked]" },
           { at: 1.6, scroll: "[data-testid=reply]" }, { at: 2.5, focus: "[data-testid=reply]" }] }, hold: { 11: 1.2 } },
  { open: "unid", view: "Maya's view", chapter: "A payment with no invoice number", lines: {
      12: [{ at: 0, focus: { all: ".page-head h1", pad: 10 } }, { at: 3.4, focus: { all: "[data-testid=verdict] h2", pad: 14 } }],
      13: [{ at: 0, focus: { all: "[data-testid=suggestion]", maxW: 1300, maxH: 420 } }, { at: 0.6, move: "[data-testid=score]" }],
      14: [{ at: 0, focus: { all: "[data-testid=suggestion] textarea, [data-testid=confirm-match]", pad: 16, maxW: 1300 } }, { at: 0, move: "[data-testid=suggestion] textarea" }, { at: 0.5, click: "[data-testid=suggestion] textarea" },
           { at: 0.7, type: ["[data-testid=suggestion] textarea", "Exact amount from Kite's usual wallet"] }, { at: 3.0, move: "[data-testid=confirm-match]" },
           { at: 3.6, click: "[data-testid=confirm-match]", nav: true }, { at: 4.6, focus: { all: "[data-testid=verdict] h2, [data-testid=verdict] ul", pad: 10, maxW: 1300 }, tick: true }] }, hold: { 14: 1.6 } },
  { end: true, lines: { 15: [] } },
];

// Without line 7, line 8 starts Acme's payment itself.
if (!LINES.includes(7)) SCENES[2].lines[8] = [{ at: 0, focus: { all: ".page-head h1", pad: 10 } }, { at: 0, move: "[data-testid=play-payment]" }, { at: 0.5, click: "[data-testid=play-payment]" },
  { at: 3.4, focus: { all: "[data-testid=verdict] h2, [data-testid=verdict] ul", pad: 10, maxW: 1300 }, tick: true }];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 2880, height: 1620 }, colorScheme: "dark" });
  await ctx.addInitScript(`try{localStorage.setItem('desk.theme','dark')}catch(e){}
    document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(HIDE)}; document.head.appendChild(s); });`);
  const page = await ctx.newPage();
  await page.request.post(BASE + "/api/requests/demo", { data: { kind: "reset" } });
  // The customer's page and the unidentified payment have generated URLs: read them from the glance page.
  await page.goto(BASE + "/requests"); await page.waitForLoadState("networkidle");
  const urls = { pay: await page.getAttribute("[data-testid=fernhill-sender]", "href"),
                 unid: await page.getAttribute("[data-testid=attention-item]:has-text('Unidentified')", "href") };
  await page.goto("about:blank");

  const cdp = await ctx.newCDPSession(page);
  const frames = []; let n = 0;
  cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
    const f = `f${String(n++).padStart(6, "0")}.jpg`;
    fs.writeFileSync(path.join(OUT, "frames", f), Buffer.from(data, "base64")); frames.push({ f, t: metadata.timestamp });
    try { await cdp.send("Page.screencastFrameAck", { sessionId }); } catch {}
  });
  const firstScene = SCENES.find((sc) => !sc.end && Object.keys(sc.lines).map(Number).some((i) => LINES.includes(i)));
  await page.goto(BASE + (urls[firstScene.open] || firstScene.open)); await page.waitForLoadState("networkidle"); await page.addStyleTag({ content: HIDE }); await new Promise((r) => setTimeout(r, 600));
  const T0 = Date.now() / 1000;
  const now = () => Date.now() / 1000 - T0;
  const log = { lines: [], focus: [], cursor: [], dips: [], views: [], end: null, urls };
  const sleepUntil = async (t) => { const d = t - now(); if (d > 0) await new Promise((r) => setTimeout(r, d * 1000)); };
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: 2880, maxHeight: 1620, everyNthFrame: 1 });

  async function box(spec) {
    if (spec === "viewport") return [0, 0, 2880, 1620];
    if (typeof spec === "string") { const b = await page.locator(spec).first().boundingBox(); return b && [b.x, b.y, b.width, b.height]; }
    if (spec.all) {
      let ls = await page.locator(spec.all).all(); if (spec.first) ls = ls.slice(0, spec.first);
      const bs = (await Promise.all(ls.map((l) => l.boundingBox()))).filter(Boolean);
      const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y));
      const x1 = Math.max(...bs.map((b) => b.x + b.width)), y1 = Math.max(...bs.map((b) => b.y + b.height)); const p = spec.pad || 0;
      return [x0 - 2 * p, y0 - 2 * p, Math.min(spec.maxW || 1e9, x1 - x0 + 4 * p), Math.min(spec.maxH || 1e9, y1 - y0 + 4 * p)];
    }
    // A text label: walk up to the first block at least minW x minH (the card it sits in).
    return page.evaluate(({ text, minW = 0, minH = 0 }) => { minW *= 2; minH *= 2;
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let el = null;
      while (w.nextNode()) if (w.currentNode.textContent.trim().startsWith(text)) { el = w.currentNode.parentElement; break; }
      while (el && el.parentElement) { const r = el.getBoundingClientRect(); if (r.width >= minW && r.height >= minH) return [r.x, r.y, r.width, r.height]; el = el.parentElement; }
      return null;
    }, spec);
  }
  const centre = async (spec) => { const b = await box(spec); return b && [b[0] + Math.min(b[2] / 2, 160), b[1] + Math.min(b[3] / 2, 48)]; };

  async function dipTo(fn, label) {   // fade to a chapter card, change the page, fade back: never two pages at once
    const a = now(); log.dips.push({ from: a, to: null, label: label || null });
    await sleepUntil(a + 0.35); await fn(); await new Promise((r) => setTimeout(r, 450));
    if (label) await sleepUntil(a + 2.0);   // a chapter card stays up long enough to read
    log.dips[log.dips.length - 1].to = now();
  }
  let first = true;
  for (const sc of SCENES) {
    const ids = Object.keys(sc.lines).map(Number).filter((i) => LINES.includes(i));
    if (!ids.length) continue;
    if (sc.end) { log.end = now() + 0.35; log.dips.push({ from: now(), to: now() + 0.6 }); await sleepUntil(now() + 0.6); }
    else {
      const go = async () => { await page.goto(BASE + (urls[sc.open] || sc.open)); await page.waitForLoadState("networkidle"); await page.addStyleTag({ content: HIDE }); await new Promise((r) => setTimeout(r, 300)); };
      if (first) first = false; else await dipTo(go, sc.chapter);
      log.views.push({ t: now(), text: sc.view });
    }
    for (const i of ids) {
      const t0 = now(); const d = dur(i); log.lines.push({ i, t: t0, d });
      const beats = (sc.lines[i] || []).map((b) => ({ ...b, at: b.at < 0 ? d + b.at : b.at })).sort((a, b) => a.at - b.at);
      for (const b of beats) {
        await sleepUntil(t0 + b.at);
        if (b.focus) { const bb = await box(b.focus); if (bb) log.focus.push({ t: now(), box: bb, red: !!b.red, tick: !!b.tick }); }
        if (b.move) { const c = await centre(b.move); if (c) { log.cursor.push({ t: now(), kind: "move", x: c[0], y: c[1] }); await page.mouse.move(c[0], c[1], { steps: 8 }); } }
        if (b.click) { const c = await centre(b.click); if (c) { log.cursor.push({ t: now(), kind: "click", x: c[0], y: c[1] }); await page.mouse.move(c[0], c[1]);
            if (b.nav) await Promise.all([page.waitForURL((u) => !u.toString().includes("/payments/")), page.mouse.click(c[0], c[1])]).then(() => page.waitForLoadState("networkidle")).then(() => page.addStyleTag({ content: HIDE }));
            else await page.mouse.click(c[0], c[1]); } }
        if (b.type) { await page.keyboard.type(b.type[1], { delay: 38 }); }
        if (b.scroll) { await page.locator(b.scroll).first().evaluate((e) => e.scrollIntoView({ block: "center", behavior: "smooth" }));
          await new Promise((r) => setTimeout(r, 900)); }   // let the scroll finish before the next focus is measured
      }
      await sleepUntil(t0 + d + HOLD * (sc.hold?.[i] || sc.lines.hold?.[i] || 0) + GAP);
    }
  }
  await sleepUntil(now() + (PLAN === "full" ? 3.0 : 2.0));   // the end card's hold
  await cdp.send("Page.stopScreencast"); await browser.close();
  log.frames = frames.map((f) => ({ f: f.f, t: f.t - T0 })); log.duration = now();
  fs.writeFileSync(path.join(OUT, "rec.json"), JSON.stringify(log, null, 1));
  console.log(PLAN, "recorded", frames.length, "frames,", log.duration.toFixed(1), "s");
})();
