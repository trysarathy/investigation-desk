import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FundingStore } from "../../src/lib/funding/store";
import { emptyFunding } from "../../src/lib/funding/model";
import { applyFundingEvent } from "../../src/lib/funding/review";
import {
  hashPassword,
  verifyPassword,
  login,
  authenticate,
  logout,
  fundingConfig,
  assertOrigin,
  readBody,
  advanceClock,
  fundingStore,
  type FundingConfig,
} from "../../src/lib/funding/server";
let dir: string, config: FundingConfig;
const password = "Synthetic-auth-test-password",
  at = "2026-11-09T10:00:00Z";
const request = (token: string) =>
  new Request("http://127.0.0.1:3000/api/funding", {
    headers: { cookie: `clearline_session=${token}` },
  });
async function saveConfig(value: unknown = config) {
  await writeFile(path.join(dir, "access.json"), JSON.stringify(value), {
    mode: 0o600,
  });
}
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "funding-auth-"));
  process.env.CLEARLINE_FUNDING_DIR = dir;
  process.env.CLEARLINE_ORIGIN = "http://127.0.0.1:3000";
  config = {
    version: 1,
    simulation: true,
    clock: at,
    users: [
      {
        id: "maker",
        email: "maker@example.test",
        password_hash: hashPassword(password),
      },
    ],
  };
  await saveConfig();
  const data = applyFundingEvent(emptyFunding(), {
    action: "users",
    at,
    actor_id: "maker",
    advance_id: "",
    reason: "Synthetic test setup",
    users: [{ id: "maker", name: "Maker", role: "operator" }],
    import_count: 0,
    base_revision: 0,
  });
  await writeFile(path.join(dir, "funding.json"), JSON.stringify(data), {
    mode: 0o600,
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
  delete process.env.CLEARLINE_FUNDING_DIR;
  delete process.env.CLEARLINE_ORIGIN;
});
describe("funding authentication and request boundaries", () => {
  it("verifies password hashes asynchronously and bounds simultaneous work", async () => {
    const hash = config.users[0].password_hash;
    const jobs = Array.from({ length: 8 }, () =>
      verifyPassword(password, hash),
    );
    const outcomes = await Promise.allSettled(jobs);
    expect(
      outcomes.filter((r) => r.status === "fulfilled" && r.value === true),
    ).toHaveLength(4);
    expect(outcomes.filter((r) => r.status === "rejected")).toHaveLength(4);
    await expect(verifyPassword("wrong", hash)).resolves.toBe(false);
    await expect(verifyPassword(password, "scrypt$bad")).resolves.toBe(false);
    await expect(verifyPassword(password, hash)).resolves.toBe(true);
  });
  it("does not disclose whether a validly formatted account exists", async () => {
    await expect(login("unknown@example.test", password)).rejects.toThrow(
      "Email or password is incorrect.",
    );
    await expect(login("maker@example.test", "wrong")).rejects.toThrow(
      "Email or password is incorrect.",
    );
  });
  it("charges concurrent attempts before expensive verification", async () => {
    const outcomes = await Promise.allSettled(
      Array.from({ length: 8 }, () => login("absent@example.test", "wrong")),
    );
    expect(outcomes.every((r) => r.status === "rejected")).toBe(true);
    expect(
      outcomes.filter(
        (r) => r.status === "rejected" && String(r.reason).includes("Too many"),
      ),
    ).toHaveLength(3);
    await expect(login("absent@example.test", password)).rejects.toThrow(
      "Too many",
    );
  });
  it("revokes sessions after credential rotation and logout", async () => {
    const first = await login("maker@example.test", password);
    expect((await authenticate(request(first.token))).user.id).toBe("maker");
    config.users[0].password_hash = hashPassword("A-new-synthetic-password");
    await saveConfig();
    await expect(authenticate(request(first.token))).rejects.toThrow("Sign in");
    const second = await login(
      "maker@example.test",
      "A-new-synthetic-password",
    );
    logout(request(second.token));
    await expect(authenticate(request(second.token))).rejects.toThrow(
      "Sign in",
    );
  });
  it("expires sessions and refuses a different deployment", async () => {
    const first = await login("maker@example.test", password);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 8 * 3600000 + 1);
    await expect(authenticate(request(first.token))).rejects.toThrow("Sign in");
    vi.restoreAllMocks();
    const second = await login("maker@example.test", password);
    process.env.CLEARLINE_FUNDING_DIR = dir + "-different";
    await expect(authenticate(request(second.token))).rejects.toThrow(
      "Sign in",
    );
  });
  for (const variant of [
    "unknown",
    "empty-id",
    "uppercase-email",
    "extra-user-key",
    "duplicate-id",
    "wrong-hash",
    "clock-in-live",
    "string-simulation",
  ] as const)
    it(`rejects invalid access config: ${variant}`, async () => {
      const value = JSON.parse(JSON.stringify(config));
      if (variant === "unknown") value.unrecognised = true;
      if (variant === "empty-id") value.users[0].id = "";
      if (variant === "uppercase-email")
        value.users[0].email = "Maker@example.test";
      if (variant === "extra-user-key") value.users[0].role = "approver";
      if (variant === "duplicate-id")
        value.users.push({ ...value.users[0], email: "other@example.test" });
      if (variant === "wrong-hash") value.users[0].password_hash = "plaintext";
      if (variant === "clock-in-live") value.simulation = false;
      if (variant === "string-simulation") value.simulation = "false";
      await saveConfig(value);
      await expect(fundingConfig()).rejects.toThrow();
    });
  it("requires exact HTTPS origins except explicit loopback development", () => {
    for (const origin of [
      "http://127.0.0.1:3000",
      "http://localhost:3000",
      "http://[::1]:3000",
      "https://desk.example.test",
    ]) {
      process.env.CLEARLINE_ORIGIN = origin;
      expect(() =>
        assertOrigin(new Request(origin, { headers: { origin } })),
      ).not.toThrow();
    }
    for (const origin of [
      "http://desk.example.test",
      "http://localhost.evil.test",
      "https://desk.example.test/path",
      "not a URL",
    ]) {
      process.env.CLEARLINE_ORIGIN = origin;
      expect(() =>
        assertOrigin(
          new Request("https://desk.example.test", { headers: { origin } }),
        ),
      ).toThrow();
    }
    process.env.CLEARLINE_ORIGIN = "https://desk.example.test";
    expect(() =>
      assertOrigin(
        new Request("https://desk.example.test", {
          headers: { origin: "https://evil.test" },
        }),
      ),
    ).toThrow();
    expect(() =>
      assertOrigin(
        new Request("https://desk.example.test", {
          headers: {
            origin: "https://desk.example.test",
            "sec-fetch-site": "cross-site",
          },
        }),
      ),
    ).toThrow();
  });
  it("permits only a verified Codespaces origin translation", () => {
    const previousName = process.env.CODESPACE_NAME;
    const previousDomain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
    const previousOrigin = process.env.CLEARLINE_ORIGIN;
    try {
      process.env.CODESPACE_NAME = "supreme-robot-abc123";
      process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN = "app.github.dev";
      process.env.CLEARLINE_ORIGIN =
        "https://supreme-robot-abc123-8766.app.github.dev";
      const url = process.env.CLEARLINE_ORIGIN + "/api/funding";
      const headers = {
        origin: "http://localhost:8766",
        host: "supreme-robot-abc123-8766.app.github.dev",
        referer: process.env.CLEARLINE_ORIGIN + "/funding",
        "sec-fetch-site": "same-origin",
      };
      expect(() => assertOrigin(new Request(url, { headers }))).not.toThrow();
      expect(() =>
        assertOrigin(
          new Request(url, {
            headers: { ...headers, origin: "http://127.0.0.1:8766" },
          }),
        ),
      ).not.toThrow();
      for (const changed of [
        { origin: "https://evil.test" },
        { origin: "http://localhost:8767" },
        { host: "evil.test" },
        { referer: "https://evil.test/funding" },
        { referer: "https://supreme-robot-abc123-8766.app.github.dev/evil" },
        { "sec-fetch-site": "cross-site" },
        { "sec-fetch-site": "none" },
      ]) {
        expect(() =>
          assertOrigin(
            new Request(url, { headers: { ...headers, ...changed } }),
          ),
        ).toThrow();
      }
      process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN = "evil.test";
      expect(() => assertOrigin(new Request(url, { headers }))).toThrow();
      process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN = "app.github.dev";
      delete process.env.CODESPACE_NAME;
      expect(() => assertOrigin(new Request(url, { headers }))).toThrow();
    } finally {
      if (previousName === undefined) delete process.env.CODESPACE_NAME;
      else process.env.CODESPACE_NAME = previousName;
      if (previousDomain === undefined)
        delete process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
      else process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN = previousDomain;
      if (previousOrigin === undefined) delete process.env.CLEARLINE_ORIGIN;
      else process.env.CLEARLINE_ORIGIN = previousOrigin;
    }
  });
  it("rejects nonobjects, malformed JSON, invalid UTF8 and misleading media types", async () => {
    for (const body of ["[]", "null", "{bad", new Uint8Array([0xff])])
      await expect(
        readBody(
          new Request("https://desk.test", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
          }),
        ),
      ).rejects.toThrow();
    await expect(
      readBody(
        new Request("https://desk.test", {
          method: "POST",
          headers: { "content-type": "application/jsonp" },
          body: "{}",
        }),
      ),
    ).rejects.toThrow("JSON");
    await expect(
      readBody(
        new Request("https://desk.test", {
          method: "POST",
          headers: { "content-type": "application/json; charset=utf-8" },
          body: '{"ok":true}',
        }),
      ),
    ).resolves.toEqual({ ok: true });
  });
  it("cancels oversized streams and releases their reader lock", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(2_100_001));
      },
      cancel() {
        cancelled = true;
      },
    });
    const req = new Request("https://desk.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    await expect(readBody(req)).rejects.toThrow("too large");
    expect(cancelled).toBe(true);
    expect(stream.locked).toBe(false);
  });
  it("rejects oversized declared length before reading the stream", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const req = new Request("https://desk.test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "2100001",
      },
      body: stream,
      duplex: "half",
    } as RequestInit);
    await expect(readBody(req)).rejects.toThrow("too large");
    expect(cancelled).toBe(true);
  });
  it("records requested and completed replay clock changes", async () => {
    await advanceClock("2026-11-10T10:00:00Z", { kind: "user", id: "maker" });
    expect((await fundingConfig()).clock).toBe("2026-11-10T10:00:00Z");
    const audit = await fundingStore().inspectAudit();
    expect(audit.entries.slice(-2).map((e) => e.action)).toEqual([
      "clock_requested",
      "clock_recorded",
    ]);
  });
  it("reports failure if the completed clock audit cannot be recorded", async () => {
    const original = FundingStore.prototype.recordAudit;
    vi.spyOn(FundingStore.prototype, "recordAudit").mockImplementation(
      function (this: FundingStore, input, revision) {
        if (input.action === "clock_recorded")
          return Promise.reject(Error("Synthetic audit disk failure"));
        return original.call(this, input, revision);
      },
    );
    await expect(
      advanceClock("2026-11-10T10:00:00Z", { kind: "user", id: "maker" }),
    ).rejects.toThrow("audit disk failure");
    expect((await fundingConfig()).clock).toBe("2026-11-10T10:00:00Z");
    expect((await fundingStore().inspectAudit()).entries.at(-1)?.action).toBe(
      "clock_requested",
    );
  });
  it("bounds global login attempts before hashing even when config is unavailable", async () => {
    const now = Date.now() + 120000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    await writeFile(path.join(dir, "access.json"), "bad JSON", { mode: 0o600 });
    for (let i = 0; i < 100; i++)
      await expect(login(`unknown${i}@example.test`, password)).rejects.toThrow(
        "configuration",
      );
    await expect(login("another@example.test", password)).rejects.toThrow(
      "busy",
    );
    vi.spyOn(Date, "now").mockReturnValue(now + 61000);
    await saveConfig();
    await expect(login("maker@example.test", password)).resolves.toHaveProperty(
      "token",
    );
  });
});
