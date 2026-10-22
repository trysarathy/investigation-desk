const { spawn } = require("node:child_process");
const fs = require("node:fs");
const { chromium } = require("playwright");
(async () => {
  const port = 3017,
    base = `http://127.0.0.1:${port}`;
  const server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      env: {
        ...process.env,
        DEMO_MODE: "1",
        AI_EXPLANATIONS: "off",
        NODE_USE_ENV_PROXY: "1",
        NO_PROXY: "localhost,127.0.0.1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  let browser;
  try {
    for (let i = 0; i < 120; i++) {
      try {
        await fetch(base);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || "/tmp/desk-chromium",
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    const p = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    fs.mkdirSync("artifacts/qa", { recursive: true });
    for (const [name, url] of [
      ["queue", "/"],
      ["investigation", "/cases/CS-1057"],
      ["scan", "/scan"],
      ["bulk", "/bulk"],
      ["accuracy", "/accuracy"],
      ["connections", "/connections"],
      ["intelligence", "/intelligence"],
      ["reports", "/reports"],
      ["security", "/security"],
      ["settings", "/settings"],
    ]) {
      const response = await p.goto(base + url);
      await p.screenshot({
        path: `artifacts/qa/${name}-light.png`,
        fullPage: true,
        animations: "disabled",
      });
      if (response.status() !== 200)
        errors.push(url + " HTTP " + response.status());
    }
    await p.goto(base + "/scan");
    await p.getByRole("button", { name: "Explore fictional demo" }).click();
    await p.getByText("48", { exact: true }).waitFor();
    await p.screenshot({
      path: "artifacts/qa/scan-report-light.png",
      fullPage: true,
      animations: "disabled",
    });
    const href = await p.getByText("Export PDF").getAttribute("href");
    const pdf = await fetch(base + href);
    fs.writeFileSync(
      "artifacts/qa/company-scan.pdf",
      Buffer.from(await pdf.arrayBuffer()),
    );
    await p.evaluate(() =>
      document.documentElement.setAttribute("data-theme", "dark"),
    );
    await p.screenshot({
      path: "artifacts/qa/scan-report-dark.png",
      fullPage: true,
      animations: "disabled",
    });
    await p.setViewportSize({ width: 390, height: 844 });
    await p.screenshot({
      path: "artifacts/qa/scan-report-mobile.png",
      fullPage: true,
      animations: "disabled",
    });
    const scans = [];
    for (const [company, address] of [
      [
        "BitPay (explorer attribution, unconfirmed)",
        "0x2730ef3c0c180e7f7bcfca249c757421b208e333",
      ],
      [
        "CoinPayments (explorer attribution, unconfirmed)",
        "0x005ad9b93955bf76d180c66f33fe84bd0f3310b5",
      ],
      [
        "CoinsPaid (explorer attribution, unconfirmed)",
        "0x7bdb61d76ab2237102a7203da24816ef0a6408f6",
      ],
    ]) {
      const res = await fetch(base + "/api/scans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          company,
          addresses: [{ chain: "ethereum", address }],
          days: 7,
        }),
      });
      let r = await res.json();
      for (let i = 0; i < 120 && r.status === "running"; i++) {
        await new Promise((r) => setTimeout(r, 500));
        r = await (await fetch(base + "/api/scans/" + r.id)).json();
      }
      scans.push(r);
    }
    fs.writeFileSync(
      "artifacts/qa/public-company-scan-attempts.json",
      JSON.stringify(scans, null, 2),
    );
    fs.mkdirSync("artifacts/qa/public-evidence", { recursive: true });
    for (const r of scans)
      for (const source of r.sources ?? []) {
        const from = ".data/raw/" + source.sha256 + ".json";
        if (fs.existsSync(from))
          fs.copyFileSync(
            from,
            "artifacts/qa/public-evidence/" + source.sha256 + ".json",
          );
      }
    console.log(
      JSON.stringify(
        {
          screenshots: 13,
          pageErrors: errors,
          scans: scans.map((r) => ({
            company: r.company,
            status: r.status,
            errors: r.errors,
          })),
        },
        null,
        2,
      ),
    );
    if (errors.length) process.exitCode = 1;
  } catch (e) {
    console.error(e);
    console.error(log.slice(-4000));
    process.exitCode = 1;
  } finally {
    await browser?.close();
    server.kill();
  }
})();
