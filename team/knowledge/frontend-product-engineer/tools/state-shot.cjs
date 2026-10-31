const { chromium } = require("playwright");
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await p.goto(process.argv[2], { waitUntil: "networkidle" }); await p.screenshot({ path: process.argv[3] }); console.log((await p.innerText("body")).slice(0, 400)); await b.close(); })();
