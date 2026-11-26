/** v1 phase 1.1 onboarding: pure parts (tokens, the invitation email, header parsing, the email outbox, sign-up refusal). Fictional values only. */
import { afterEach, describe, expect, it } from "vitest";
import { EmailNotConfigured, emailSender, invitationSender } from "../../src/server/email";
import { outboxSender } from "../../src/server/email/outbox";
import { disabledSender, validMessage } from "../../src/server/email/sender";
import { AcceptInput, INVITATION_HOURS, invitationEmail, invitationLink, inviteAndDeliver, newInvitationToken, tokenSha256 } from "../../src/server/onboarding/invitations";
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

describe("the email sender (one interface since the wave 1 integration)", () => {
  it("unconfigured: an invitation refuses (no real email service is ever called); other mail is dropped", () => {
    delete process.env.CLEARLINE_EMAIL_SENDER;
    expect(() => emailSender({ required: true })).toThrow(EmailNotConfigured);
    expect(emailSender()).toBe(disabledSender);
    process.env.CLEARLINE_EMAIL_SENDER = "smtp"; // anything but "outbox" is not a sender in this build
    expect(() => emailSender({ required: true })).toThrow(EmailNotConfigured);
  });

  it("CLEARLINE_EMAIL_SENDER=outbox selects the local outbox table; a provisioning transaction queues through its own function", async () => {
    process.env.CLEARLINE_EMAIL_SENDER = "outbox";
    expect(emailSender({ required: true })).toBe(outboxSender);
    const calls: [string, unknown[]][] = [];
    const prov = { call: async (fn: string, args: unknown[]) => { calls.push([fn, args]); return []; } };
    const s = emailSender({ required: true, prov: prov as never });
    await s.send({ to: "a@merchant.example", subject: "one", text: "first", kind: "invitation" });
    expect(calls).toEqual([["prov_queue_invitation_email", ["a@merchant.example", "one", "first"]]]);
    // only invitations, plain text, valid messages go that way
    await expect(s.send({ to: "a@merchant.example", subject: "one", text: "first" })).rejects.toThrow(/refused/);
    await expect(s.send({ to: "a@merchant.example", subject: "two\nlines", text: "x", kind: "invitation" })).rejects.toThrow(/refused/);
    expect(calls).toHaveLength(1);
  });

  it("no sender: an invitation is delivered as a one-time link returned once (the database gets the hash only); with one, by email", async () => {
    delete process.env.CLEARLINE_EMAIL_SENDER;
    process.env.CLEARLINE_ORIGIN = "https://control.example";
    expect(invitationSender()).toBeNull();
    const stored: string[] = [];
    const mail = () => { throw new Error("no email is composed without a sender"); };
    const r = await inviteAndDeliver(async (t) => { stored.push(t.sha256); return { invitationId: "inv-1" }; }, mail, null);
    expect(r).toMatchObject({ invitationId: "inv-1", delivery: "link" });
    const token = /#token=([A-Za-z0-9_-]{43})$/.exec(r.delivery === "link" ? r.link : "")?.[1] ?? "";
    expect(r.delivery === "link" && r.link).toBe(`https://control.example/control/invite#token=${token}`);
    expect(stored).toEqual([tokenSha256(token)]);
    expect(r.delivery === "link" && Math.abs(new Date(r.expiresAt).getTime() - Date.now() - 72 * 3600_000)).toBeLessThan(5000);
    // no CLEARLINE_ORIGIN: refused before anything is written
    delete process.env.CLEARLINE_ORIGIN;
    const none: string[] = [];
    await expect(inviteAndDeliver(async (t) => { none.push(t.sha256); return {}; }, mail, null)).rejects.toThrow(/CLEARLINE_ORIGIN/);
    expect(none).toEqual([]);
    // a configured sender: the email path, no link in the answer
    process.env.CLEARLINE_EMAIL_SENDER = "outbox";
    expect(invitationSender()).toBe(outboxSender);
    process.env.CLEARLINE_ORIGIN = "https://control.example";
    const sent: string[] = [];
    const e = await inviteAndDeliver(async () => ({ invitationId: "inv-2" }), (t) => invitationEmail({ to: "a@merchant.example", orgName: "F", role: "viewer", token: t.token, expiresAt: t.expiresAt }),
      { send: async (m) => { sent.push(m.text); } });
    expect(e).toEqual({ invitationId: "inv-2", delivery: "email" });
    expect(sent).toHaveLength(1);
  });

  it("message limits are shared by every sender", () => {
    expect(validMessage({ to: "a@merchant.example", subject: "s", text: "t", kind: "password_reset" })).toBe(true);
    expect(validMessage({ to: "not an address", subject: "s", text: "t" })).toBe(false);
    expect(validMessage({ to: "a@merchant.example", subject: "s", text: "t", kind: "Bad Kind" })).toBe(false);
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
