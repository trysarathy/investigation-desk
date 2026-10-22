const { spawn } = require("node:child_process");
const { scryptSync, createHmac } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const password = "local-test-only",
  salt = "ephemeral-test-salt",
  totpSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
function otp() {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac("sha1", Buffer.from("12345678901234567890"))
      .update(b)
      .digest(),
    o = h[19] & 15;
  return ((h.readUInt32BE(o) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, "0");
}
(async () => {
  const port = 3027,
    base = `http://127.0.0.1:${port}`,
    users = ["analyst", "lead", "admin"].map((role) => ({
      id: role,
      role,
      salt,
      passwordHash: scryptSync(password, salt, 64).toString("hex"),
      totpSecret,
    }));
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
        SESSION_SECRET: "test-session-secret-".repeat(3),
        DESK_USERS: JSON.stringify(users),
        DESK_DATA_DIR: fs.mkdtempSync(os.tmpdir() + "/desk-e2e-"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  const checks = [];
  function check(ok, name) {
    checks.push({ name, ok });
    if (!ok) throw Error(name);
  }
  async function request(path, cookie, body) {
    return fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(cookie ? { cookie } : {}),
        origin: base,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
    });
  }
  try {
    for (let i = 0; i < 80; i++) {
      try {
        await fetch(base, { signal: AbortSignal.timeout(1000) });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    check(
      (await request("/api/scans/x")).status === 401,
      "Unauthenticated API refused",
    );
    const cookies = {};
    const codes = {};
    for (const role of ["analyst", "lead", "admin"]) {
      codes[role] = otp();
      const r = await request("/api/auth/login", null, {
        id: role,
        password,
        otp: codes[role],
      });
      check(r.status === 200, role + " password + TOTP login");
      cookies[role] = r.headers.get("set-cookie").split(";")[0];
    }
    check(
      (
        await request("/api/auth/login", null, {
          id: "analyst",
          password,
          otp: codes.analyst,
        })
      ).status === 401,
      "TOTP replay rejected",
    );
    check(
      (await request("/api/bulk", cookies.analyst, {})).status === 403,
      "Analyst bulk denied",
    );
    check(
      (await request("/api/settings", cookies.lead, {})).status === 403,
      "Lead policy edit denied",
    );
    const hash =
      "3df337646f7390bbdf68c458e579d2bfd64541a18b0548d003e3865f2b4b3064";
    const times = [];
    let id;
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      const r = await request("/investigate?q=" + hash, cookies.analyst);
      const body = await r.text();
      times.push(Math.round(performance.now() - start));
      id = ((r.headers.get("location") ?? "") + body).match(
        /CASE-[a-f0-9]{20}/,
      )?.[0];
      check(!!id, "Investigation stored " + i);
    }
    check(
      (
        await request("/api/cases/" + id + "/feedback", cookies.analyst, {
          actual: "D12",
          reason: "Confirmed fictional demo evidence",
        })
      ).status === 200,
      "Feedback persisted",
    );
    check(
      (await request("/api/cases/" + id + "/adjudicate", cookies.analyst, {}))
        .status === 403,
      "Analyst adjudication denied",
    );
    check(
      (await request("/api/cases/" + id + "/adjudicate", cookies.lead, {}))
        .status === 200,
      "Independent lead adjudication",
    );
    const regression = await (
      await request("/api/regressions", cookies.lead)
    ).json();
    check(
      regression.candidates.some(
        (c) => c.label.adjudicated && c.expected === "D12",
      ),
      "Adjudication propagated to regression export",
    );
    check(
      (await request("/api/cases/" + id + "/resolve", cookies.analyst, {}))
        .status === 200,
      "Resolution recorded",
    );
    const scan = await (
      await request("/api/scans", cookies.analyst, {
        company: "Fictional E2E",
        days: 7,
        addresses: [{ chain: "ethereum", address: "Fictional" }],
        demo: true,
      })
    ).json();
    let result;
    for (let i = 0; i < 20; i++) {
      result = await (
        await request("/api/scans/" + scan.id, cookies.analyst)
      ).json();
      if (result.status !== "running") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    check(result.transfers.length === 48, "Background scan completed");
    check(
      (await request("/api/scans/" + scan.id + "/pdf", cookies.analyst))
        .status === 403,
      "Analyst export denied",
    );
    const pdf = await request("/api/scans/" + scan.id + "/pdf", cookies.lead);
    check(
      pdf.status === 200 &&
        pdf.headers.get("content-type") === "application/pdf",
      "Lead PDF export",
    );
    const out = {
      checks,
      investigationMs: times,
      mode: "Production build; recorded public chain data and fictional company records; no live latency claim",
    };
    fs.writeFileSync(
      "artifacts/qa/e2e-results.json",
      JSON.stringify(out, null, 2),
    );
    console.log(JSON.stringify(out, null, 2));
  } catch (e) {
    console.error(e);
    console.error(log.slice(-3000));
    process.exitCode = 1;
  } finally {
    server.kill();
  }
})();
