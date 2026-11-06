import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { sum, sub } from "../payments/money";
import {
  emptyFunding,
  instant,
  visible,
  type FundingData,
  type ImportKind,
} from "./model";
import { columns, importCsv } from "./imports";
import { applyFundingEvent, type FundingEvent } from "./review";
import {
  applyFundingEvent as legacyEvent,
  type FundingEvent as LegacyEvent,
} from "./review-v2";
import { canonicalPayouts, fundingLedger } from "./ledger";
import { validateFundingData } from "./store";
import { zipStored, crc32 } from "./outputs/xlsx";
const MAX_ARCHIVE = 64 * 1024 * 1024,
  MAX_MEMBER = 4 * 1024 * 1024,
  MAX_FILES = 256;
export const sha256 = (body: string | Buffer) =>
  createHash("sha256").update(body).digest("hex");
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, item]) => [k, sort(item)]),
          )
        : v;
  return JSON.stringify(sort(value), null, 2) + "\n";
}
export interface EvidenceHashes {
  format: "clearline-evidence-hashes/v1";
  archive_sha256: string;
  manifest_sha256: string;
  archive_bytes: number;
}
function beforeEvent(data: FundingData, index: number) {
  let rebuilt = emptyFunding(),
    imported = 0;
  for (let i = 0; i <= index; i++) {
    const e = data.events[i];
    while (imported < e.import_count) {
      const b = data.imports[imported++];
      rebuilt = importCsv(
        rebuilt,
        b.kind,
        b.text,
        b.mapping,
        b.filename,
        b.imported_at,
      );
    }
    rebuilt.revision = e.base_revision;
    if (i < index) {
      const input = { ...e };
      delete (input as Partial<FundingEvent>).id;
      delete (input as Partial<FundingEvent>).review;
      rebuilt =
        e.engine_version === undefined
          ? legacyEvent(rebuilt, input as Omit<LegacyEvent, "id" | "review">)
          : applyFundingEvent(rebuilt, input);
    }
  }
  return rebuilt;
}
function cashEvidence(data: FundingData, event: FundingEvent) {
  const a = data.advances.find((a) => a.id === event.advance_id)!;
  // Both recorded policy versions select the latest visible account/currency snapshot.
  const cash = data.cash.filter(
    (c) =>
      c.account === a.account &&
      c.currency === a.currency &&
      visible(c, event.at),
  );
  const latest = [...cash].sort(
    (left, right) => instant(right.effective_at) - instant(left.effective_at),
  )[0];
  const buckets = latest
    ? cash.filter((c) => c.snapshot_id === latest.snapshot_id)
    : [];
  const snapshot = latest;
  const payouts = (
    event.engine_version === undefined
      ? data.payouts
      : canonicalPayouts(data, event.at).accepted
  ).filter(
    (p) =>
      visible(p, event.at) &&
      p.account === a.account &&
      p.currency === a.currency &&
      snapshot &&
      instant(p.effective_at) >= instant(snapshot.effective_at),
  );
  const restricted = sum(
    buckets.filter((c) => c.classification !== "free").map((c) => c.amount),
  );
  const spent = sum(payouts.map((p) => p.amount));
  const reserved = event.review?.reserved_cash ?? null;
  const recorded = event.review?.free_cash ?? null;
  return {
    interpretation:
      "Evidence from before this event. Recorded checks are preserved, not replaced by current policy.",
    formula:
      "gross balance - classified restricted portions - recorded local reservations - payouts at/after snapshot",
    buckets,
    classified_restrictions: restricted,
    recorded_reservations: reserved,
    post_snapshot_payouts: payouts,
    post_snapshot_spend: spent,
    recorded_free_cash: recorded,
    formula_matches_recorded:
      recorded !== null && snapshot && reserved !== null
        ? sub(sub(sub(snapshot.balance, restricted), reserved), spent) ===
          recorded
        : null,
    commitment_evidence: data.advances.filter(
      (row) =>
        row.account === a.account &&
        row.currency === a.currency &&
        row.id !== a.id &&
        row.state === "approved" &&
        visible(row, event.at),
    ),
    classification_note:
      "Provider classifications require confirmation with counsel. Pending-bucket overlap may cause conservative double deduction.",
  };
}
export function buildEvidence(
  data: FundingData,
  advanceId: string,
  at: string,
  simulation = false,
) {
  validateFundingData(data);
  instant(at);
  const advance = data.advances.find(
    (a) => a.id === advanceId && visible(a, at),
  );
  if (!advance)
    throw Error("No advance was known with that ID at the selected time.");
  const ledger = fundingLedger(data, at);
  const row = ledger.rows.find((r) => r.advance_id === advanceId)!;
  const events = data.events
    .map((event, index) => ({ event, index }))
    .filter(
      ({ event }) =>
        event.advance_id === advanceId &&
        event.action !== "users" &&
        instant(event.at) <= instant(at),
    );
  const payload: Record<string, string> = {};
  const put = (name: string, value: unknown) => {
    payload[name] = canonicalJson(value);
  };
  const selected = new Set<number>();
  for (const kind of Object.keys(columns) as ImportKind[])
    for (const record of data[kind].filter((r) => visible(r, at))) {
      data.imports.forEach((b, index) => {
        if (b.kind === kind && record.source.startsWith(`${b.sha256}:`))
          selected.add(index);
      });
    }
  const decisions = [];
  for (const { event, index } of events) {
    for (let i = 0; i < event.import_count; i++) selected.add(i);
    const prefix = beforeEvent(data, index);
    const path = `decisions/${String(index).padStart(6, "0")}-${event.id}.json`;
    put(path, {
      event,
      policy_version: event.engine_version ?? 2,
      actor: prefix.users.find((u) => u.id === event.actor_id) ?? null,
      import_count: event.import_count,
      checks_status: event.review
        ? "exact recorded snapshot"
        : "no check snapshot for this action",
    });
    if (event.review)
      put(path.replace(".json", "-cash.json"), cashEvidence(prefix, event));
    decisions.push({
      path,
      event_id: event.id,
      action: event.action,
      at: event.at,
    });
  }
  const imports = [...selected]
    .sort((a, b) => a - b)
    .map((index) => {
      const b = data.imports[index];
      const path = `inputs/${String(index).padStart(6, "0")}-${b.sha256}.csv`;
      payload[path] = b.text;
      return {
        position: index,
        path,
        original_filename: b.filename,
        kind: b.kind,
        sha256: b.sha256,
        mapping: b.mapping,
        imported_at: b.imported_at,
        warning:
          "Full source file retained. Rows may concern other records or later knowledge; do not treat every row as evidence available at a decision.",
      };
    });
  const record = { ...advance };
  delete (record as Partial<typeof advance>).state;
  put("advance.json", {
    record,
    as_of: at,
    state_at_as_of: row.state,
    supplier_delivery: row.supplier_delivery,
    simulation,
  });
  put("inputs.json", imports);
  put("decisions.json", {
    events: decisions,
    approval_status: events.some(({ event }) => event.action === "approve")
      ? "recorded approval included"
      : "no Clearline approval recorded by this time",
  });
  const relatedReceipt = (r: FundingData["receipts"][number]) =>
    r.customer_id === advance.customer_id ||
    r.reference === advance.id ||
    r.reference === advance.invoice_ref ||
    ledger.allocations.some(
      (a) => a.advance_id === advance.id && a.receipt_id === r.id,
    );
  put("repayment-history.json", {
    as_of: at,
    receipts: data.receipts.filter((r) => visible(r, at) && relatedReceipt(r)),
    allocations: ledger.allocations.filter((a) => a.advance_id === advance.id),
    writeoffs: events
      .filter(({ event }) => event.action === "write_off")
      .map(({ event }) => event),
    note: "A receipt is not a repayment until allocated. Write-offs are not repayments.",
  });
  put("current-position.json", {
    row,
    exceptions: ledger.exceptions.filter(
      (e) =>
        e.advance_id === advance.id ||
        data.receipts.some((r) => r.id === e.receipt_id && relatedReceipt(r)),
    ),
    as_of: at,
  });
  payload["README.txt"] =
    `${simulation ? "SYNTHETIC SAMPLE\n" : ""}Clearline evidence for advance ${advanceId}, as of ${at}.\nProvider-internal review pack. Full retained CSVs may contain other supplied records and later-known facts. Review and redact through an authorised process before sharing outside the provider. Decisions contain their original check snapshots and policy versions; later receipts are separate.\nSHA-256 verifies byte identity against a separately trusted expected hash. It does not prove bank authenticity, evidence completeness, legal treatment or bank/auditor acceptance. An administrator can rebuild the whole archive and sidecar. Keep the expected hashes in a separate trusted channel or record.\nThe manifest hashes every payload file but cannot hash itself. The detached sidecar hashes the manifest and the complete archive. No money moved and no file was sent.\n`;
  const names = Object.keys(payload).sort();
  if (
    names.length + 1 > MAX_FILES ||
    names.some((n) => Buffer.byteLength(payload[n]) > MAX_MEMBER) ||
    sumBytes(payload) > MAX_ARCHIVE - 100000
  )
    throw Error(
      "Evidence pack exceeds the bounded archive size; split the source records first.",
    );
  const manifest = canonicalJson({
    format: "clearline-evidence/v1",
    advance_id: advanceId,
    as_of: at,
    simulation,
    files: Object.fromEntries(
      names.map((name) => [
        name,
        {
          sha256: sha256(payload[name]),
          bytes: Buffer.byteLength(payload[name]),
        },
      ]),
    ),
  });
  const members: Record<string, string> = {
    ...payload,
    "manifest.json": manifest,
  };
  const archive = zipStored(members);
  const hashes: EvidenceHashes = {
    format: "clearline-evidence-hashes/v1",
    archive_sha256: sha256(archive),
    manifest_sha256: sha256(manifest),
    archive_bytes: archive.length,
  };
  return { archive, hashes, members };
}
const sumBytes = (files: Record<string, string>) =>
  Object.values(files).reduce(
    (total, text) => total + Buffer.byteLength(text),
    0,
  );

/** Reads only bounded, uncompressed evidence archives; never extracts files. */
export function verifyEvidence(archive: Buffer, expected: EvidenceHashes) {
  const fail = (why: string): never => {
    throw Error(`Evidence archive: ${why}`);
  };
  if (
    !expected ||
    expected.format !== "clearline-evidence-hashes/v1" ||
    !Number.isSafeInteger(expected.archive_bytes) ||
    !/^[a-f0-9]{64}$/.test(expected.archive_sha256) ||
    !/^[a-f0-9]{64}$/.test(expected.manifest_sha256)
  )
    fail("invalid trusted hashes");
  if (
    archive.length > MAX_ARCHIVE ||
    archive.length < 22 ||
    archive.length !== expected.archive_bytes ||
    sha256(archive) !== expected.archive_sha256
  )
    fail("archive hash or size differs");
  const u16 = (n: number) => {
    if (n < 0 || n + 2 > archive.length) fail("truncated ZIP");
    return archive.readUInt16LE(n);
  };
  const u32 = (n: number) => {
    if (n < 0 || n + 4 > archive.length) fail("truncated ZIP");
    return archive.readUInt32LE(n);
  };
  const end = archive.length - 22;
  if (u32(end) !== 0x06054b50 || u16(end + 4) || u16(end + 6) || u16(end + 20))
    fail("unsupported ZIP end record");
  const count = u16(end + 10),
    size = u32(end + 12),
    offset = u32(end + 16);
  if (
    count < 1 ||
    count > MAX_FILES ||
    u16(end + 8) !== count ||
    offset + size !== end
  )
    fail("invalid directory");
  const files: Record<string, Buffer> = Object.create(null);
  let cursor = offset,
    localEnd = 0;
  for (let i = 0; i < count; i++) {
    if (
      cursor + 46 > end ||
      u32(cursor) !== 0x02014b50 ||
      u16(cursor + 8) ||
      u16(cursor + 10) ||
      u16(cursor + 30) ||
      u16(cursor + 32) ||
      u16(cursor + 34)
    )
      fail("unsupported directory entry");
    const length = u32(cursor + 24),
      packed = u32(cursor + 20),
      nameLength = u16(cursor + 28),
      local = u32(cursor + 42),
      crc = u32(cursor + 16);
    if (
      length > MAX_MEMBER ||
      length !== packed ||
      cursor + 46 + nameLength > end ||
      local !== localEnd
    )
      fail("invalid member bounds");
    if (
      archive
        .subarray(cursor + 46, cursor + 46 + nameLength)
        .some((byte) => byte > 127)
    )
      fail("non-ASCII member name");
    const name = archive
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString("ascii");
    if (
      !/^[A-Za-z0-9_.\/[\]-]+$/.test(name) ||
      name.startsWith("/") ||
      name.split("/").some((p) => p === ".." || p === "" || p === ".") ||
      Object.prototype.hasOwnProperty.call(files, name)
    )
      fail("unsafe or duplicate member name");
    if (
      local + 30 + nameLength + length > offset ||
      u32(local) !== 0x04034b50 ||
      u16(local + 6) ||
      u16(local + 8) ||
      u16(local + 28) ||
      u16(local + 26) !== nameLength ||
      u32(local + 14) !== crc ||
      u32(local + 18) !== packed ||
      u32(local + 22) !== length ||
      !archive
        .subarray(local + 30, local + 30 + nameLength)
        .equals(archive.subarray(cursor + 46, cursor + 46 + nameLength))
    )
      fail("local header differs");
    const body = archive.subarray(
      local + 30 + nameLength,
      local + 30 + nameLength + length,
    );
    if (crc32(body) !== crc) fail("CRC differs");
    files[name] = body;
    localEnd = local + 30 + nameLength + length;
    cursor += 46 + nameLength;
  }
  if (cursor !== end || localEnd !== offset) fail("unreferenced ZIP data");
  const manifest = files["manifest.json"];
  if (!manifest || sha256(manifest) !== expected.manifest_sha256)
    fail("manifest hash differs");
  let value: unknown;
  try {
    value = JSON.parse(manifest.toString("utf8"));
  } catch {
    fail("invalid manifest JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("invalid manifest");
  const m = value as Record<string, unknown>;
  if (
    !isDeepStrictEqual(Object.keys(m).sort(), [
      "advance_id",
      "as_of",
      "files",
      "format",
      "simulation",
    ]) ||
    m.format !== "clearline-evidence/v1" ||
    typeof m.advance_id !== "string" ||
    !m.advance_id ||
    typeof m.as_of !== "string" ||
    typeof m.simulation !== "boolean" ||
    !m.files ||
    typeof m.files !== "object" ||
    Array.isArray(m.files) ||
    canonicalJson(m) !== manifest.toString("utf8")
  )
    fail("invalid manifest schema");
  instant(m.as_of as string);
  const entries = m.files as Record<string, { sha256: string; bytes: number }>;
  if (
    !isDeepStrictEqual(
      Object.keys(entries).sort(),
      Object.keys(files)
        .filter((n) => n !== "manifest.json")
        .sort(),
    )
  )
    fail("missing or extra payload");
  for (const [name, entry] of Object.entries(entries)) {
    if (
      !entry ||
      !isDeepStrictEqual(Object.keys(entry).sort(), ["bytes", "sha256"]) ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes !== files[name].length ||
      entry.sha256 !== sha256(files[name])
    )
      fail("payload hash or size differs");
  }
  return {
    advance_id: m.advance_id as string,
    as_of: m.as_of as string,
    files: Object.keys(entries).length,
  };
}
