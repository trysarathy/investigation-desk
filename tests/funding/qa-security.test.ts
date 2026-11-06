import { beforeEach, afterEach, describe, it, expect } from "vitest";
import {
  mkdtemp,
  writeFile as fsWriteFile,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GET, POST } from "../../src/app/api/funding/route";
import { emptyFunding, type ImportKind } from "../../src/lib/funding/model";
import { importCsv } from "../../src/lib/funding/imports";
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
  dir = await mkdtemp(path.join(tmpdir(), "funding-independent-"));
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
describe("independent security integration probes", () => {
  it("exports identical evidence while durable audit grows and business revision stays fixed", async () => {
    const { cookie, csrf, state } = await signIn();
    const before = await fundingStore().inspectAudit();
    const a = await POST(request({ action: "export", format: "evidence", advance_id: "advance-1" }, cookie, csrf));
    const b = await POST(request({ action: "export", format: "evidence", advance_id: "advance-1" }, cookie, csrf));
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(Buffer.from(await a.arrayBuffer()).equals(Buffer.from(await b.arrayBuffer()))).toBe(true);
    const after = await fundingStore().inspectAudit(before.anchor);
    expect(after.data.revision).toBe(state.revision);
    const exports = after.entries.filter(e => e.action === "export_prepared");
    expect(exports).toHaveLength(2);
    expect(exports[0].details.sha256).toBe(exports[1].details.sha256);
    expect(after.anchor.sequence).toBe(before.anchor.sequence + 2);
    expect((await stat(path.join(dir, "funding.json"))).mode & 0o777).toBe(0o600);
  });
  it("records denied viewer action without logging submitted credentials or supplied actor", async () => {
    const { cookie, csrf, state } = await signIn("viewer");
    const sentinel = "PRIVATE-UNTRUSTED-CREDENTIAL-MUST-NOT-LOG";
    const denied = await POST(request({ action: "approve", advance_id: "advance-1", revision: state.revision, reason: sentinel, password: sentinel, actor_id: "checker" }, cookie, csrf));
    expect(denied.ok).toBe(false);
    const audited = await fundingStore().inspectAudit();
    expect(audited.data.revision).toBe(state.revision);
    expect(audited.entries.at(-1)?.action).toBe("request_failed");
    expect(audited.entries.at(-1)?.actor).toEqual({ kind: "user", id: "viewer" });
    const disk = await readFile(path.join(dir,"funding.json"),"utf8");
    expect(disk).not.toContain(sentinel);
    expect(disk).not.toContain(password);
    expect(disk).not.toContain(csrf);
    expect(disk).not.toContain(cookie.split("=")[1]);
  });
  it("keeps clock replacements private and preserves an independent trusted anchor", async () => {
    const { cookie, csrf } = await signIn();
    const anchor = (await fundingStore().inspectAudit()).anchor;
    const before = await readFile(path.join(dir,"funding.json"),"utf8");
    const result = await POST(request({ action: "clock", at: "2026-11-10T10:00:00Z" }, cookie, csrf));
    expect(result.status).toBe(200);
    expect((await stat(path.join(dir,"access.json"))).mode & 0o777).toBe(0o600);
    const current = await fundingStore().inspectAudit(anchor);
    expect(current.anchor.sequence).toBeGreaterThan(anchor.sequence);
    await writeFile(path.join(dir,"funding.json"),before);
    await expect(fundingStore().inspectAudit(current.anchor)).rejects.toThrow(/anchor/);
  });
});
