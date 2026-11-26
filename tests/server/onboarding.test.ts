/** v1 phase 1.1 onboarding: pure parts (tokens, the invitation email, header parsing, the email outbox, sign-up refusal). Fictional values only. */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EmailNotConfigured, emailSender, OutboxEmailSender, readOutbox } from "../../src/server/email";
import { AcceptInput, INVITATION_HOURS, invitationEmail, invitationLink, newInvitationToken, tokenSha256 } from "../../src/server/onboarding/invitations";
import { headersOfLine } from "../../src/server/onboarding/wizard";
import { platformConsoleEnabled } from "../../src/server/onboarding/platform";

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

describe("invitation tokens", () => {
  it("are 32 random bytes (base64url, 43 characters); only their SHA-256 is stored; they expire after the stated hours", () => {
    const now = new Date("2026-11-25T00:00:00Z");
    const a = newInvitationToken(now), b = newInvitationToken(now);
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.sha256).toBe(tokenSha256(a.token));
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.expiresAt.getTime() - now.getTime()).toBe(INVITATION_HOURS * 3600_000);
    expect(AcceptInput.safeParse({ token: a.token }).success).toBe(true);
    expect(AcceptInput.safeParse({ token: "short" }).success).toBe(false);
    expect(AcceptInput.safeParse({ token: a.token, password: "too-short" }).success).toBe(false);
  });

  it("the link carries the token in the #fragment (never sent to a server) and needs CLEARLINE_ORIGIN", () => {
    expect(invitationLink("TOKEN", "https://control.example")).toBe("https://control.example/control/invite#token=TOKEN");
    delete process.env.CLEARLINE_ORIGIN;
    expect(() => invitationLink("TOKEN")).toThrow(/CLEARLINE_ORIGIN/);
  });

  it("the email names the organisation and role, holds the link, and says when it expires", () => {
    process.env.CLEARLINE_ORIGIN = "https://control.example";
    const t = newInvitationToken(new Date("2026-11-25T00:00:00Z"));
    const m = invitationEmail({ to: "first.admin@merchant.example", orgName: "Fictional Merchant Pte", role: "admin", token: t.token, expiresAt: t.expiresAt });
    expect(m.kind).toBe("invitation");
    expect(m.subject).toBe("You are invited to Fictional Merchant Pte on Clearline");
    expect(m.text).toContain("as Admin.");
    expect(m.text).toContain(`https://control.example/control/invite#token=${t.token}`);
    expect(m.text).toContain("2026-11-28 00:00 UTC");
    expect(m.text).not.toContain(t.sha256);
  });
});

describe("the email sender", () => {
  it("refuses without a configured outbox (no real email service is ever called)", () => {
    delete process.env.CLEARLINE_EMAIL_OUTBOX_DIR;
    expect(() => emailSender({ required: true })).toThrow(EmailNotConfigured);
  });

  it("the local outbox writes one JSON file per message, read back oldest first", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "clearline-outbox-"));
    try {
      process.env.CLEARLINE_EMAIL_OUTBOX_DIR = dir;
      const s = emailSender();
      expect(s).toBeInstanceOf(OutboxEmailSender);
      const a = await (s as OutboxEmailSender).send({ to: "a@merchant.example", subject: "one", text: "first", kind: "invitation" });
      await new Promise((r) => setTimeout(r, 5));
      await s.send({ to: "b@merchant.example", subject: "two", text: "second", kind: "invitation" });
      const out = await readOutbox(dir);
      expect(out.map((m) => m.subject)).toEqual(["one", "two"]);
      expect(out[0].id).toBe(a.id);
      expect(await readOutbox(path.join(dir, "missing"))).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("the wizard's header row parser", () => {
  it("reads comma, semicolon and tab separated header rows, first line only, quotes removed", () => {
    expect(headersOfLine("Order ID,Amount,Currency\n1,2,3")).toEqual(["Order ID", "Amount", "Currency"]);
    expect(headersOfLine('"Date";"Description";"Amount"')).toEqual(["Date", "Description", "Amount"]);
    expect(headersOfLine("Date\tAmount\t")).toEqual(["Date", "Amount"]);
  });
});

describe("the platform console flag", () => {
  it("is off unless CLEARLINE_PLATFORM_CONSOLE is exactly 1", () => {
    delete process.env.CLEARLINE_PLATFORM_CONSOLE;
    expect(platformConsoleEnabled()).toBe(false);
    process.env.CLEARLINE_PLATFORM_CONSOLE = "true";
    expect(platformConsoleEnabled()).toBe(false);
    process.env.CLEARLINE_PLATFORM_CONSOLE = "1";
    expect(platformConsoleEnabled()).toBe(true);
  });
});

describe("the pilot's sign-in fast path", () => {
  it("lets the public invitation page through without a session; every other Control page still needs one", async () => {
    const { isControlPage } = await import("../../src/middleware");
    expect(isControlPage("/control/invite")).toBe(false);
    expect(isControlPage("/control/sign-in")).toBe(false);
    for (const p of ["/control", "/control/platform", "/control/merchant/setup", "/control/invitex", "/control/merchant"]) expect(isControlPage(p), p).toBe(true);
  });
});
