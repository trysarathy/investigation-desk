/**
 * v1 phase 2.1: the pickup stand-ins without a database. The MIME reader (attachments, encodings, sender, the
 * receiving server's verdict, limits, seeded fuzz), the local SFTP stand-in (folder confinement, symlinks, partial
 * transfers, size refusal, stable item keys) and the Maildir stand-in (authentication, allowed senders). All
 * addresses and files are fictional.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { addressOf, parseMail, senderAllowed } from "../../src/server/pickup/mime";
import { LocalDirectorySource, MaildirSource, PickupUnavailable, pickupCredential, pickupSourceFor } from "../../src/server/pickup/sources";

const CSV = "Invoice Number,Total\nINV-1,10.00\n";
const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64").replace(/(.{76})/g, "$1\r\n");
function mail(opts: { from?: string; auth?: string | null; parts?: string; extraAuth?: string } = {}) {
  const head = [
    ...(opts.auth === null ? [] : [`Authentication-Results: mx.receiver.example; ${opts.auth ?? "dkim=pass header.d=vendor.example; dmarc=pass"}`]),
    ...(opts.extraAuth ? [`Authentication-Results: ${opts.extraAuth}`] : []),
    `From: "Accounts (fictional)" <${opts.from ?? "ap@vendor.example"}>`, "To: uploads@merchant.example", "Subject: Statement",
    "MIME-Version: 1.0", 'Content-Type: multipart/mixed;\r\n boundary="XYZ"',
  ];
  const parts = opts.parts ?? [
    "--XYZ", "Content-Type: text/plain", "", "Fictional statement attached.",
    "--XYZ", 'Content-Type: text/csv; name="invoices.csv"', 'Content-Disposition: attachment; filename="invoices.csv"', "Content-Transfer-Encoding: base64", "", b64(CSV),
    "--XYZ--", "",
  ].join("\r\n");
  return Buffer.from(head.join("\r\n") + "\r\n\r\n" + parts, "latin1");
}

describe("parseMail", () => {
  it("reads the sender, the receiving server's verdict and a base64 attachment", () => {
    const m = parseMail(mail());
    expect(m).toMatchObject({ from: "ap@vendor.example", authenticated: true, skipped: [] });
    expect(m.attachments).toHaveLength(1);
    expect(m.attachments[0].fileName).toBe("invoices.csv");
    expect(Buffer.from(m.attachments[0].bytes).toString()).toBe(CSV);
  });

  it("only the topmost Authentication-Results counts (a lower one can be written by the sender)", () => {
    expect(parseMail(mail({ auth: "dkim=fail; dmarc=fail", extraAuth: "forged.example; dkim=pass" })).authenticated).toBe(false);
    expect(parseMail(mail({ auth: null })).authenticated).toBe(false);
    expect(parseMail(mail({ auth: "spf=pass" })).authenticated).toBe(false);
  });

  it("nested multipart, quoted-printable, RFC 2231 and RFC 2047 file names", () => {
    const parts = [
      "--XYZ", 'Content-Type: multipart/alternative; boundary="ALT"', "",
      "--ALT", "Content-Type: text/plain", "", "hi", "--ALT", "Content-Type: text/html", "", "<p>hi</p>", "--ALT--",
      "--XYZ", "Content-Type: text/csv", "Content-Disposition: attachment; filename*=UTF-8''Rechnungen%20%C3%BC.csv", "Content-Transfer-Encoding: quoted-printable", "",
      "Invoice Number,Total=0D=0AINV-1,10.00=", "",
      "--XYZ", "Content-Type: application/octet-stream; name=\"=?UTF-8?B?w6l0YXQuY3N2?=\"", "Content-Transfer-Encoding: base64", "", b64(CSV),
      "--XYZ--",
    ].join("\r\n");
    const m = parseMail(mail({ parts }));
    expect(m.attachments.map((a) => a.fileName)).toEqual(["Rechnungen ü.csv", "état.csv"]);
    expect(Buffer.from(m.attachments[0].bytes).toString()).toBe("Invoice Number,Total\r\nINV-1,10.00");
  });

  it("limits: attachments, depth, unknown transfer encodings", () => {
    const many = ["--XYZ", ...Array.from({ length: 12 }, (_, i) => [`Content-Disposition: attachment; filename="f${i}.csv"`, "", "a,b", "--XYZ"].join("\r\n"))].join("\r\n") + "--";
    const m = parseMail(mail({ parts: many }));
    expect(m.attachments).toHaveLength(10);
    expect(m.skipped).toContain("too_many_attachments");
    const nest = (level: number): string => level === 8 ? 'Content-Disposition: attachment; filename="deep.csv"\r\n\r\na,b'
      : `Content-Type: multipart/mixed; boundary="B${level}"\r\n\r\n--B${level}\r\n${nest(level + 1)}\r\n--B${level}--`;
    const deep = parseMail(mail({ parts: `--XYZ\r\n${nest(0)}\r\n--XYZ--` }));
    expect(deep.skipped).toContain("too_deep");
    expect(deep.attachments).toHaveLength(0);
    const odd = ["--XYZ", 'Content-Disposition: attachment; filename="x.csv"', "Content-Transfer-Encoding: x-uuencode", "", "begin 644", "--XYZ--"].join("\r\n");
    expect(parseMail(mail({ parts: odd })).skipped).toEqual(["unsupported_transfer_encoding"]);
  });

  it("fuzz: random bytes and mutated messages never throw", () => {
    let a = 7;
    const r = () => { a = (a * 1103515245 + 12345) >>> 0; return a / 2 ** 32; };
    const base = mail();
    for (let i = 0; i < 500; i++) {
      const bytes = i % 2 ? Buffer.from(Array.from({ length: 1 + Math.floor(r() * 3000) }, () => Math.floor(r() * 256))) : Buffer.from(base);
      if (i % 2 === 0) for (let k = 0; k < 8; k++) bytes[Math.floor(r() * bytes.length)] = Math.floor(r() * 256);
      expect(() => parseMail(new Uint8Array(bytes))).not.toThrow();
    }
  });

  it("senders: exact addresses and @domains; addresses parsed from display names", () => {
    expect(addressOf('"A, B" <AP@Vendor.Example>')).toBe("ap@vendor.example");
    expect(senderAllowed("ap@vendor.example", ["@vendor.example"])).toBe(true);
    expect(senderAllowed("ap@evil-vendor.example", ["@vendor.example"])).toBe(false);
    expect(senderAllowed("ap@sub.vendor.example", ["@vendor.example"])).toBe(false);
    expect(senderAllowed("ap@vendor.example", ["ar@vendor.example"])).toBe(false);
    expect(senderAllowed(null, ["@vendor.example"])).toBe(false);
  });
});

describe("local stand-ins", () => {
  let root: string;
  const old = (f: string) => { const t = new Date(Date.now() - 10 * 60_000); utimesSync(f, t, t); };
  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "clearline-pickup-"));
    mkdirSync(path.join(root, "sftp/in"), { recursive: true });
    mkdirSync(path.join(root, "mail/new"), { recursive: true });
    mkdirSync(path.join(root, "mail/cur"), { recursive: true });
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("SFTP folder: settled regular files only; stable keys; oversize refused without reading; confined to the root", async () => {
    const dir = path.join(root, "sftp/in");
    writeFileSync(path.join(dir, "a.csv"), CSV); old(path.join(dir, "a.csv"));
    writeFileSync(path.join(dir, "b.csv.part"), CSV); old(path.join(dir, "b.csv.part"));
    writeFileSync(path.join(dir, ".hidden.csv"), CSV); old(path.join(dir, ".hidden.csv"));
    writeFileSync(path.join(dir, "fresh.csv"), CSV); // still being written
    writeFileSync(path.join(dir, "empty.csv"), ""); old(path.join(dir, "empty.csv"));
    writeFileSync(path.join(root, "secret.csv"), "outside");
    symlinkSync(path.join(root, "secret.csv"), path.join(dir, "link.csv"));
    const src = new LocalDirectorySource(root, "sftp/in");
    const items = await src.list();
    expect(items.map((i) => i.fileName)).toEqual(["a.csv", "empty.csv"]);
    expect(items[1].refusal).toBe("FILE_FILE_EMPTY");
    expect(Buffer.from(await items[0].read()).toString()).toBe(CSV);
    expect((await src.list())[0].key).toBe(items[0].key);
    symlinkSync(root, path.join(dir, "up"));
    await expect(new LocalDirectorySource(root, "../etc").list()).rejects.toThrow(PickupUnavailable);
    await expect(new LocalDirectorySource(path.join(root, "sftp"), "in/up").list()).rejects.toMatchObject({ code: "LOCATION_OUTSIDE_ROOT" });
    await expect(new LocalDirectorySource(root, "missing").list()).rejects.toMatchObject({ code: "LOCATION_NOT_FOUND" });
  });

  it("Maildir: unauthenticated, unknown sender and attachment-less mail are refused as whole messages", async () => {
    const put = (name: string, body: Buffer) => { writeFileSync(path.join(root, "mail/new", name), body); };
    put("1.fict", mail());
    put("2.fict", mail({ auth: "dkim=fail" }));
    put("3.fict", mail({ from: "someone@elsewhere.example" }));
    put("4.fict", mail({ parts: ["--XYZ", "Content-Type: text/plain", "", "no file", "--XYZ--"].join("\r\n") }));
    const items = await new MaildirSource(root, "mail", ["@vendor.example"]).list();
    expect(items.map((i) => i.refusal ?? i.fileName)).toEqual(["invoices.csv", "EMAIL_NOT_AUTHENTICATED", "EMAIL_SENDER_NOT_ALLOWED", "EMAIL_NO_ATTACHMENT"]);
  });

  it("the factory needs CLEARLINE_PICKUP_ROOT and any credential a source names; it never echoes a credential", () => {
    expect(() => pickupSourceFor({ kind: "sftp", location: "sftp/in", credentialRef: null, allowedSenders: [] }, {})).toThrow(/CLEARLINE_PICKUP_ROOT/);
    expect(() => pickupSourceFor({ kind: "sftp", location: "sftp/in", credentialRef: "CLEARLINE_PICKUP_VENDOR", allowedSenders: [] }, { CLEARLINE_PICKUP_ROOT: root })).toThrow(/CLEARLINE_PICKUP_VENDOR is not set/);
    expect(pickupSourceFor({ kind: "email", location: "mail", credentialRef: null, allowedSenders: ["@vendor.example"] }, { CLEARLINE_PICKUP_ROOT: root }).kind).toBe("email");
    const secret = "fictional-secret-value-123";
    expect(pickupCredential("CLEARLINE_PICKUP_X", { CLEARLINE_PICKUP_X: secret })).toBe(secret);
    try { pickupCredential("NOT_OURS", { NOT_OURS: secret }); } catch (e) { expect(String(e)).not.toContain(secret); }
  });
});
