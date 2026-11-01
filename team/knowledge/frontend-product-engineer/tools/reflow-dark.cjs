const { chromium } = require("playwright");
(async () => { const b = await chromium.launch();
  for (const scheme of ["light", "dark"]) for (const r of process.argv.slice(3)) {
    const p = await b.newPage({ viewport: { width: scheme === "light" ? 320 : 1280, height: 800 }, colorScheme: scheme });
    await p.goto(process.argv[2] + r, { waitUntil: "networkidle" });
    let out = "";
    if (scheme === "light") { const w = await p.evaluate(() => document.documentElement.scrollWidth); out = `320px scrollWidth ${w}`; }
    else { await p.addScriptTag({ path: process.env.AXE }); const v = await p.evaluate(async () => (await axe.run(document, { runOnly: { type: "rule", values: ["color-contrast", "link-in-text-block"] } })).violations.map(x => x.id + "x" + x.nodes.length).join(",")); out = `dark@1280 ${v || "0"}`; }
    console.log(r, out); await p.close(); }
  await b.close(); })();
