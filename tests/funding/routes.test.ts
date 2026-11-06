import { beforeEach, afterEach, describe, it, expect } from "vitest";
import {
  mkdtemp,
  writeFile as fsWriteFile,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GET, POST } from "../../src/app/api/funding/route";
import { emptyFunding, type ImportKind } from "../../src/lib/funding/model";
import { columns, importCsv } from "../../src/lib/funding/imports";
import { applyFundingEvent } from "../../src/lib/funding/review";
import { hashPassword, fundingStore } from "../../src/lib/funding/server";
const writeFile = (file: string, data: string | Buffer) =>
  fsWriteFile(file, data, { mode: 0o600 });
let dir: string;
const at = "2026-11-09T10:00:00Z",
  origin = "http://127.0.0.1:3000",
  password = "Synthetic-password-only-123";
const request = (
  body: unknown,
  cookie = "",
  csrf = "",
  requestOrigin = origin,
) =>
  new Request(origin + "/api/funding", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: requestOrigin,
      cookie,
      "x-csrf-token": csrf,
    },
    body: JSON.stringify(body),
  });
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "funding-route-"));
  process.env.CLEARLINE_FUNDING_ONLY = "1";
  process.env.CLEARLINE_FUNDING_DIR = dir;
  process.env.CLEARLINE_ORIGIN = origin;
  let d = emptyFunding();
  for (const k of ["customers", "advances", "cash"] as ImportKind[])
    d = importCsv(
      d,
      k,
      await readFile(`fixtures/funding/${k}.csv`, "utf8"),
      undefined,
      k,
      at,
    );
  d = applyFundingEvent(d, {
    action: "users",
    at,
    actor_id: "maker",
    advance_id: "",
    reason: "Synthetic setup",
    users: [
      { id: "maker", name: "Maker", role: "operator" },
      { id: "checker", name: "Checker", role: "approver" },
      { id: "viewer", name: "Viewer", role: "viewer" },
    ],
    import_count: d.imports.length,
    base_revision: 0,
  });
  await writeFile(path.join(dir, "funding.json"), JSON.stringify(d));
  await writeFile(
    path.join(dir, "access.json"),
    JSON.stringify({
      version: 1,
      simulation: true,
      clock: at,
      users: d.users.map((u) => ({
        id: u.id,
        email: `${u.id}@example.test`,
        password_hash: hashPassword(password),
      })),
    }),
  );
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.CLEARLINE_FUNDING_ONLY;
  delete process.env.CLEARLINE_FUNDING_DIR;
  delete process.env.CLEARLINE_ORIGIN;
});
async function signIn(id = "maker") {
  const res = await POST(
    request({ action: "login", email: `${id}@example.test`, password }),
  );
  expect(res.status).toBe(200);
  const cookie = res.headers.get("set-cookie")!.split(";")[0];
  const state = await (
    await GET(new Request(origin + "/api/funding", { headers: { cookie } }))
  ).json();
  return { cookie, csrf: state.csrf, state };
}
describe("funding authenticated entry point", () => {
  it("requires login and an enabled deployment", async () => {
    expect((await GET(new Request(origin))).status).toBe(401);
    process.env.CLEARLINE_FUNDING_ONLY = "0";
    expect(
      (
        await POST(
          request({ action: "login", email: "maker@example.test", password }),
        )
      ).status,
    ).toBe(400);
  });
  it("sets an HTTP-only session and keeps server-bound roles", async () => {
    const res = await POST(
      request({ action: "login", email: "maker@example.test", password }),
    );
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
    expect(res.headers.get("set-cookie")).toContain("SameSite=strict");
    const { cookie, csrf } = await signIn();
    const attack = await POST(
      request(
        {
          action: "prepare",
          advance_id: "advance-1",
          reason: "x",
          revision: 0,
          actor_id: "checker",
        },
        cookie,
        csrf,
      ),
    );
    expect(attack.status).toBe(400);
    expect(await attack.text()).toContain("Identity");
  });
  it("blocks cross-origin and missing CSRF mutations", async () => {
    const { cookie, csrf } = await signIn();
    expect(
      (
        await POST(
          request({ action: "prepare" }, cookie, csrf, "https://wrong.example"),
        )
      ).status,
    ).toBe(400);
    expect((await POST(request({ action: "prepare" }, cookie))).status).toBe(
      400,
    );
    expect((await fundingStore().load()).advances[0].state).toBe("proposed");
  });
  it("prepares then requires a different approver, records decline reason", async () => {
    const maker = await signIn(),
      checker = await signIn("checker");
    expect(
      (
        await POST(
          request(
            {
              action: "prepare",
              advance_id: "advance-1",
              reason: "Terms checked",
              revision: 0,
            },
            maker.cookie,
            maker.csrf,
          ),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await POST(
          request(
            {
              action: "approve",
              advance_id: "advance-1",
              reason: "Self",
              revision: 1,
            },
            maker.cookie,
            maker.csrf,
          ),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          request(
            {
              action: "decline",
              advance_id: "advance-1",
              reason: "Missing evidence",
              revision: 1,
            },
            checker.cookie,
            checker.csrf,
          ),
        )
      ).status,
    ).toBe(200);
    expect((await fundingStore().load()).decisions[0].reason).toBe(
      "Missing evidence",
    );
  });
  it("viewer cannot prepare, import, classify or move the clock", async () => {
    const viewer = await signIn("viewer");
    for (const action of ["prepare", "import", "cash", "clock"])
      expect(
        (
          await POST(
            request(
              {
                action,
                advance_id: "advance-1",
                reason: "x",
                revision: 0,
                at: "2026-11-10T10:00:00Z",
              },
              viewer.cookie,
              viewer.csrf,
            ),
          )
        ).status,
      ).toBe(400);
  });
  it("exports CSV, workbook and digests without accounting configuration", async () => {
    const viewer = await signIn("viewer");
    for (const format of [
      "open-csv",
      "open-xlsx",
      "exceptions",
      "digest",
      "slack",
      "webhook",
      "evidence",
    ]) {
      const res = await POST(
        request(
          { action: "export", format, advance_id: "advance-1" },
          viewer.cookie,
          viewer.csrf,
        ),
      );
      expect(res.status, format).toBe(200);
      expect(res.headers.get("content-disposition")).toContain("attachment");
      expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
    }
  });
  it("exports each configured journal adapter", async () => {
    await writeFile(
      path.join(dir, "export-settings.json"),
      await readFile("fixtures/funding/export-settings.json"),
    );
    const user = await signIn();
    for (const format of ["journals", "xero", "netsuite"])
      expect(
        (
          await POST(
            request({ action: "export", format }, user.cookie, user.csrf),
          )
        ).status,
      ).toBe(200);
  });
  it("records latest cash snapshot without overwriting classifications", async () => {
    const u = await signIn();
    const res = await POST(
      request(
        {
          action: "cash",
          effective_at: at,
          revision: 0,
          account: "provider-sgd",
          currency: "SGD",
          balance: "200000",
          safeguarded: "20000",
          pending: "10000",
          buffer: "5000",
        },
        u.cookie,
        u.csrf,
      ),
    );
    expect(res.status).toBe(200);
    expect((await fundingStore().load()).cash).toHaveLength(8);
  });
  it("retains a provider column mapping when classifications are recorded", async () => {
    const mapping = Object.fromEntries(
      columns.cash.map((k) => [k, "provider_" + k]),
    );
    await fundingStore().update(async (d) => {
      const text = (await readFile("fixtures/funding/cash.csv", "utf8"))
        .replace(
          columns.cash.join(","),
          columns.cash.map((k) => mapping[k]).join(","),
        )
        .replaceAll("cash-", "mapped-")
        .replaceAll("snapshot-1", "mapped-snapshot")
        .replaceAll("2026-11-09T09:00:00Z", "2026-11-08T09:00:00Z");
      return [
        importCsv(d, "cash", text, mapping, "provider.csv", at),
        undefined,
      ];
    });
    const u = await signIn();
    const res = await POST(
      request(
        {
          action: "cash",
          effective_at: at,
          revision: 1,
          account: "provider-sgd",
          currency: "SGD",
          balance: "200000",
          safeguarded: "20000",
          pending: "10000",
          buffer: "5000",
        },
        u.cookie,
        u.csrf,
      ),
    );
    expect(res.status).toBe(200);
    expect((await fundingStore().load()).mappings.cash).toEqual(mapping);
  });
  it("does not refresh an old balance by reclassifying it", async () => {
    const u = await signIn();
    await POST(
      request(
        { action: "clock", at: "2026-11-12T10:00:00Z" },
        u.cookie,
        u.csrf,
      ),
    );
    const res = await POST(
      request(
        {
          action: "cash",
          effective_at: "2026-11-09T10:00:00Z",
          revision: 0,
          account: "provider-sgd",
          currency: "SGD",
          balance: "200000",
          safeguarded: "20000",
          pending: "10000",
          buffer: "5000",
        },
        u.cookie,
        u.csrf,
      ),
    );
    expect(res.status).toBe(200);
    const state = await (
      await GET(new Request(origin, { headers: { cookie: u.cookie } }))
    ).json();
    expect(
      state.reviews["advance-1"].checks.find(
        (c: { code: string }) => c.code === "cash",
      ).status,
    ).toBe("needs_review");
  });
  it("anonymous session probe is quiet and contains no provider data", async () => {
    const res = await GET(new Request(origin + "/api/funding?session=1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authenticated: false });
  });
  it("rejects excess cash restrictions without a write", async () => {
    const u = await signIn();
    expect(
      (
        await POST(
          request(
            {
              action: "cash",
              effective_at: at,
              revision: 0,
              account: "provider-sgd",
              currency: "SGD",
              balance: "10",
              safeguarded: "20",
              pending: "0",
              buffer: "0",
            },
            u.cookie,
            u.csrf,
          ),
        )
      ).status,
    ).toBe(400);
    expect((await fundingStore().load()).revision).toBe(0);
  });
  it("keeps the queue available with a future-known imported advance", async () => {
    await fundingStore().update(async (d) => {
      const text = (await readFile("fixtures/funding/advances.csv", "utf8"))
        .replace("advance-1", "future")
        .replace("INV-001", "INV-002")
        .replaceAll("2026-11-09T09:00:00Z", "2026-11-10T09:00:00Z");
      return [
        importCsv(d, "advances", text, undefined, "future.csv", at),
        undefined,
      ];
    });
    const u = await signIn();
    expect(u.state.data.advances).toHaveLength(1);
    expect(Object.keys(u.state.reviews)).toEqual(["advance-1"]);
  });
  it("invalidates logout and never accepts a role switch", async () => {
    const u = await signIn();
    expect(
      (await POST(request({ action: "logout" }, u.cookie, u.csrf))).status,
    ).toBe(200);
    expect(
      (await GET(new Request(origin, { headers: { cookie: u.cookie } })))
        .status,
    ).toBe(401);
  });
  it("returns 401 when a signed-in user's credential is revoked", async () => {
    const u = await signIn();
    const file = path.join(dir, "access.json");
    const config = JSON.parse(await readFile(file, "utf8"));
    config.users[0].password_hash = hashPassword("A-new-private-password-123");
    await writeFile(file, JSON.stringify(config));
    expect(
      (
        await POST(
          request(
            {
              action: "prepare",
              advance_id: "advance-1",
              reason: "Reviewed",
              revision: 0,
            },
            u.cookie,
            u.csrf,
          ),
        )
      ).status,
    ).toBe(401);
  });
  it("normal mode cannot use simulation actions or clock", async () => {
    const config = JSON.parse(
      await readFile(path.join(dir, "access.json"), "utf8"),
    );
    config.simulation = false;
    delete config.clock;
    await writeFile(path.join(dir, "access.json"), JSON.stringify(config));
    const u = await signIn();
    expect(u.state.simulation).toBe(false);
    for (const action of ["clock", "sample-payout"])
      expect(
        (await POST(request({ action, revision: 0, at }, u.cookie, u.csrf)))
          .status,
      ).toBe(400);
  });
  it("rejects oversized streamed JSON before mutation", async () => {
    const u = await signIn();
    const res = await POST(
      request(
        { action: "import", text: "x".repeat(2_100_001) },
        u.cookie,
        u.csrf,
      ),
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("too large");
  });
});
