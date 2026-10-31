// Keyboard-only: reach a control by Tab, operate it with Enter, read the result.
const { chromium } = require("playwright");
const [base, out] = process.argv.slice(2);
async function tabTo(p, pred, max = 80) { for (let i = 1; i <= max; i++) { await p.keyboard.press("Tab"); if (await p.evaluate(pred)) return i; } return -1; }
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  // 1. Approve posting (Xero entry preview) on DEMO-1042
  await p.goto(base + "/requests/DEMO-1042", { waitUntil: "networkidle" });
  const panel = await p.locator('[data-testid="books-panel"]').innerText();
  await p.locator('[data-testid="books-panel"]').screenshot({ path: out + "/xero-preview-DEMO-1042-before.png" });
  const n = await tabTo(p, () => document.activeElement?.getAttribute("data-testid") === "approve-posting");
  console.log("approve-posting reached after", n, "Tabs");
  await p.keyboard.press("Enter");
  await p.waitForTimeout(2500);
  console.log("status after Enter:", await p.locator('[data-testid="books-status"]').innerText());
  console.log("focus after:", await p.evaluate(() => document.activeElement?.tagName + " " + (document.activeElement?.textContent || "").slice(0, 40)));
  await p.locator('[data-testid="books-panel"]').screenshot({ path: out + "/xero-preview-DEMO-1042-after.png" });
  console.log("PANEL BEFORE:\n" + panel);
  // 2. Decision flow on DEMO-1047 (paid twice): note + first decision, keyboard only
  await p.goto(base + "/requests/DEMO-1047", { waitUntil: "networkidle" });
  const t = await tabTo(p, () => document.activeElement?.getAttribute("aria-label") === "Decision note");
  console.log("decision note reached after", t, "Tabs");
  // try first decision with empty note: error message?
  await p.keyboard.press("Tab"); const btn = await p.evaluate(() => document.activeElement?.textContent);
  await p.keyboard.press("Enter"); await p.waitForTimeout(500);
  console.log("pressed", btn, "with empty note -> focus now", await p.evaluate(() => document.activeElement?.getAttribute("aria-label")), "msg:", await p.evaluate(() => [...document.querySelectorAll('[data-testid="next-step"] *')].map(e => e.children.length === 0 ? e.textContent : "").filter(x => /note/i.test(x)).slice(0, 3)));
  await p.locator('[data-testid="next-step"]').screenshot({ path: out + "/approve-flow-DEMO-1047-empty-note.png" });
  await b.close();
})();
