// Spec section 4 validation rules and the section 6 "malformed-CSV" pre-pilot test.

import { describe, expect, it } from "vitest";
import { checkAddress, checkTimestamp, validateBulk, validateFileA, validateFileB } from "@/lib/csv/files";
import { parseCsv } from "@/lib/csv/parse";
import { applyUpload, MemoryWorkspaceStore } from "@/lib/workspace/store";

const bytes = (s: string) => new TextEncoder().encode(s);
const TRON = "TKHuVq1oKVruCGLvqVexFs6dawKv6fQgFs";
const EVM = "0x28c6c06298d514db089934071355e5743bf21d60";
const HASH = "3df337646f7390bbdf68c458e579d2bfd64541a18b0548d003e3865f2b4b3064";

const A_HEAD = "address,chain,customer_id,assigned_at,retired_at";
const B_HEAD = "deposit_id,tx_hash,chain,token,to_address,amount,status,credited_at,customer_id,transfer_index,reason_code";

describe("pre-pilot: malformed CSV", () => {
  // One file with every kind of fault the spec names, plus the CSV-level ones.
  const malformed = [
    B_HEAD,
    `D-1,${HASH},tron,USDT,${TRON},250.00,CREDITED,2026-10-21T10:00:00+08:00,C-1,0,`, // good
    `D-2,${HASH},tron,USDT,${TRON},1e3,CREDITED,2026-10-21T10:00:00+08:00,C-1,,`, // exponent amount
    `D-3,${HASH},tron,USDT,${TRON},"1,000.00",PENDING,,C-1,,`, // thousands separator
    `D-4,${HASH},solana,USDT,${TRON},5.00,PENDING,,C-1,,`, // unknown chain
    `D-5,${HASH},tron,USDT,${TRON},5.00,CREDITED,2026-10-21T10:00:00,C-1,,`, // timestamp without offset
    `D-6,${HASH},tron,USDT,${TRON},5.00,PENDING,,C-1`, // short row
    `D-7,${HASH},tron,USDT,${TRON},5.00,PENDING,, C-1,,`, // leading space
    `D-8,${HASH},tron,USDT,${TRON},-5.00,PENDING,,C-1,,`, // negative amount
    `D-9,${HASH},tron,USDT,TKHuVq1oKVruCGLvqVexFs6dawKv6fQgFt,5.00,PENDING,,C-1,,`, // bad Tron checksum
    `D-1,${HASH},tron,USDT,${TRON},5.00,PENDING,,C-1,,`, // duplicate deposit_id
    `D-11,${HASH},tron,USDT,${TRON},5.00,credited,,C-1,,`, // lower-case status: not silently upper-cased
    `D-12,${HASH},tron,USDT,${TRON},5.00,PENDING,,jane@example.com,,`, // email instead of a pseudonymous ID
    `D-13,${HASH},tron,USDT,${TRON},5"0,PENDING,,C-1,,`, // stray quote
  ].join("\n");

  it("keeps the one good row and rejects every malformed row with a row-level reason", () => {
    const r = validateFileB(bytes(malformed));
    expect(r.fileErrors).toEqual([]);
    expect(r.rows.map((x) => x.depositId)).toEqual(["D-1"]);
    const byLine = Object.fromEntries(r.rowErrors.map((e) => [e.line, e]));
    expect(byLine[3].message).toMatch(/exact decimal/);
    expect(byLine[4].message).toMatch(/exact decimal/);
    expect(byLine[5].message).toMatch(/Unknown chain "solana"/);
    expect(byLine[6].message).toMatch(/no UTC offset/);
    expect(byLine[7].message).toBe("Row has 9 values; the header has 11.");
    expect(byLine[8].message).toMatch(/leading or trailing spaces/);
    expect(byLine[9].message).toMatch(/exact decimal/);
    expect(byLine[10].message).toMatch(/checksum/);
    expect(byLine[11].message).toMatch(/Duplicate deposit_id \(first on line 2\)/);
    expect(byLine[12].message).toMatch(/Unknown status "credited"/);
    expect(byLine[13].message).toMatch(/email/);
    expect(byLine[14].message).toMatch(/Stray double quote/);
    expect(r.rowErrors).toHaveLength(12);
  });

  it("never silently fixes a value: accepted rows hold exactly what was uploaded", () => {
    const r = validateFileB(bytes(malformed));
    expect(r.rows[0]).toMatchObject({ amount: "250.00", status: "CREDITED", customerId: "C-1", transferIndex: 0 });
  });

  it("rejects the whole file when a required column is missing", () => {
    const r = validateFileB(bytes(B_HEAD.replace(",amount", "") + "\n"));
    expect(r.fileErrors).toEqual(["Missing required column(s): amount."]);
    expect(r.rows).toEqual([]);
  });

  it("rejects the file when column names differ only in case or spaces, and says why", () => {
    const r = validateFileA(bytes(A_HEAD.replace("chain", "Chain") + "\n"));
    expect(r.fileErrors[0]).toMatch(/Missing required column\(s\): chain\. Column names must match exactly \(found "Chain"\)/);
  });

  it("rejects a file with an unterminated quote, invalid UTF-8, duplicate columns, or no rows to read", () => {
    expect(validateFileA(bytes(`${A_HEAD}\n"${TRON},tron,C-1,2026-01-01T00:00:00Z,\n`)).fileErrors[0]).toMatch(/Unterminated quoted value/);
    expect(validateFileA(new Uint8Array([0x61, 0xff, 0xfe])).fileErrors).toEqual(["File is not valid UTF-8."]);
    expect(validateFileA(bytes(`${A_HEAD},chain\n`)).fileErrors[0]).toMatch(/Duplicate column/);
    expect(validateFileA(bytes("")).fileErrors).toEqual(["File is empty."]);
  });
});

describe("File A", () => {
  const good = [A_HEAD, `${TRON},tron,C-1,2024-01-01T00:00:00+08:00,`, `${EVM},ethereum,C-2,2024-01-01T00:00:00Z,2026-01-01T00:00:00Z`].join("\r\n");

  it("reads a valid file with CRLF line endings", () => {
    const r = validateFileA(bytes(good));
    expect(r.rowErrors).toEqual([]);
    expect(r.rows).toEqual([
      { row: 2, address: TRON, chain: "tron", customerId: "C-1", assignedAt: "2024-01-01T00:00:00+08:00" },
      { row: 3, address: EVM, chain: "ethereum", customerId: "C-2", assignedAt: "2024-01-01T00:00:00Z", retiredAt: "2026-01-01T00:00:00Z" },
    ]);
  });

  it("rejects overlapping assignments of one address, but allows a reassignment after retirement", () => {
    const r = validateFileA(bytes([A_HEAD,
      `${EVM},ethereum,C-1,2024-01-01T00:00:00Z,2025-01-01T00:00:00Z`,
      `${EVM},ethereum,C-2,2025-01-01T00:00:00Z,`,
      `${EVM},ethereum,C-3,2025-06-01T00:00:00Z,`].join("\n")));
    expect(r.rows.map((x) => x.customerId)).toEqual(["C-1", "C-2"]);
    expect(r.rowErrors).toEqual([expect.objectContaining({ line: 4, message: expect.stringMatching(/Overlaps line 3/) })]);
  });

  it("rejects retired_at before assigned_at, a wrong address format, and a bad EIP-55 checksum", () => {
    const mixedBad = "0x28C6c06298d514Db089934071355E5743bf21d61";
    const r = validateFileA(bytes([A_HEAD,
      `${EVM},ethereum,C-1,2025-01-01T00:00:00Z,2024-01-01T00:00:00Z`,
      `${TRON},ethereum,C-1,2025-01-01T00:00:00Z,`,
      `${mixedBad},bsc,C-1,2025-01-01T00:00:00Z,`].join("\n")));
    expect(r.rows).toEqual([]);
    expect(r.rowErrors.map((e) => e.message)).toEqual([
      "retired_at is not after assigned_at.",
      "Not an EVM address (0x followed by 40 hex characters).",
      "Mixed-case address fails its EIP-55 checksum (likely a typo).",
    ]);
  });

  it("lists unknown columns as ignored and does not store them", () => {
    const r = validateFileA(bytes(`${A_HEAD},customer_name\n${TRON},tron,C-1,2024-01-01T00:00:00Z,,Jane Doe\n`));
    expect(r.ignoredColumns).toEqual(["customer_name"]);
    expect(JSON.stringify(r.rows)).not.toContain("Jane");
  });

  it("reports a blank line and a byte-order mark instead of passing over them silently", () => {
    const r = validateFileA(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes(`${A_HEAD}\n\n${TRON},tron,C-1,2024-01-01T00:00:00Z,\n`)]));
    expect(r.rows).toHaveLength(1);
    expect(r.notes).toEqual(["UTF-8 byte-order mark at the start of the file was not read as data.", "Line 2 is blank and was not read as a row."]);
  });
});

describe("field checks", () => {
  it.each([
    ["2026-10-22T09:00:00+08:00", undefined],
    ["2026-10-22T09:00:00.123Z", undefined],
    ["2026-10-22T09:00:00", "Timestamp has no UTC offset (add Z or +08:00)."],
    ["2026-02-30T09:00:00Z", "Not a real date and time."],
    ["22/10/2026 09:00", "Not an ISO 8601 timestamp with an offset."],
  ])("timestamp %s", (v, err) => expect(checkTimestamp(v)).toBe(err));

  it("accepts the official contract addresses", () => {
    expect(checkAddress("tron", "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t")).toBeUndefined();
    expect(checkAddress("ethereum", "0xdAC17F958D2ee523a2206206994597C13D831ec7")).toBeUndefined();
  });

  it("CSV parser handles quoted commas, escaped quotes and newlines inside quotes", () => {
    const p = parseCsv('a,b\n"x,1","say ""hi""\nthere"\n');
    expect(p.records).toEqual([{ line: 2, cells: ["x,1", 'say "hi"\nthere'] }]);
  });
});

describe("uploads: SHA-256 dedupe and replace", () => {
  const fileA = bytes([A_HEAD, `${TRON},tron,C-1,2024-01-01T00:00:00Z,`].join("\n"));
  const now = new Date("2026-10-22T10:00:00Z");

  it("re-uploading the same bytes is a no-op", async () => {
    const store = new MemoryWorkspaceStore();
    const first = await applyUpload(store, "A", "a.csv", validateFileA(fileA), now);
    const second = await applyUpload(store, "A", "a-again.csv", validateFileA(fileA), new Date("2026-10-22T11:00:00Z"));
    expect(first.outcome).toBe("replaced");
    expect(second.outcome).toBe("no_change");
    const data = await store.load();
    expect(data.fileA!.upload.uploadedAt).toBe(now.toISOString());
    expect(data.history.map((h) => h.outcome)).toEqual(["no_change", "replaced"]);
  });

  it("a rejected file keeps the previous one; a new file replaces it in full", async () => {
    const store = new MemoryWorkspaceStore();
    await applyUpload(store, "A", "a.csv", validateFileA(fileA), now);
    const bad = await applyUpload(store, "A", "bad.csv", validateFileA(bytes("address\n")), now);
    expect(bad.outcome).toBe("rejected");
    expect((await store.load()).fileA!.rows).toHaveLength(1);
    await applyUpload(store, "A", "b.csv", validateFileA(bytes(`${A_HEAD}\n${EVM},bsc,C-9,2024-01-01T00:00:00Z,\n`)), now);
    expect((await store.load()).fileA!.rows.map((r) => r.customerId)).toEqual(["C-9"]);
  });
});

describe("bulk CSV", () => {
  it("accepts tx_hash with optional chain and customer_id, skips bad rows, caps at 1,000", () => {
    const r = validateBulk(bytes(["tx_hash,chain,customer_id", `${HASH},,`, `0x${HASH},bsc,C-1`, "nothex,,", `${HASH},solana,`].join("\n")));
    expect(r.rows).toEqual([{ line: 2, txHash: HASH }, { line: 3, txHash: `0x${HASH}`, chain: "bsc", customerId: "C-1" }]);
    expect(r.rowErrors.map((e) => e.line)).toEqual([4, 5]);
    const tooMany = ["tx_hash", ...Array(1001).fill(HASH)].join("\n");
    expect(validateBulk(bytes(tooMany)).fileErrors).toEqual(["File has 1001 rows; the limit is 1000."]);
  });
});
