import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  emptyFunding,
  type ImportKind,
  type FundingData,
} from "../../src/lib/funding/model";
import { columns, importCsv } from "../../src/lib/funding/imports";
import {
  applyFundingEvent,
  type FundingEvent,
} from "../../src/lib/funding/review";
import {
  buildEvidence,
  verifyEvidence,
  sha256,
  canonicalJson,
  type EvidenceHashes,
} from "../../src/lib/funding/evidence";
import { zipStored } from "../../src/lib/funding/outputs/xlsx";
const at = "2026-11-19T10:00:00Z",
  decisionAt = "2026-11-09T10:00:00Z";
function load(decision: "approve" | "decline" | null = "approve") {
  let d = emptyFunding();
  for (const k of ["customers", "advances", "cash"] as ImportKind[])
    d = importCsv(
      d,
      k,
      readFileSync(`fixtures/funding/${k}.csv`, "utf8"),
      undefined,
      `${k}.csv`,
      decisionAt,
    );
  if (decision)
    for (const action of [
      "users",
      "prepare",
      decision,
    ] as FundingEvent["action"][])
      d = applyFundingEvent(d, {
        action,
        at: decisionAt,
        actor_id:
          action === "approve" || action === "decline" ? "checker" : "maker",
        advance_id: "advance-1",
        reason: "Synthetic terms checked",
        users:
          action === "users"
            ? [
                { id: "maker", name: "Operator", role: "operator" },
                { id: "checker", name: "Treasury", role: "approver" },
              ]
            : [],
        import_count: d.imports.length,
        base_revision: d.revision,
      });
  for (const k of ["payouts", "receipts"] as ImportKind[])
    d = importCsv(
      d,
      k,
      readFileSync(`fixtures/funding/${k}.csv`, "utf8"),
      undefined,
      `${k}.csv`,
      at,
    );
  return d;
}
const pack = (d: FundingData = load()) =>
  buildEvidence(d, "advance-1", at, true);
const changedArchive = (archive: Buffer, hashes: EvidenceHashes) => ({
  ...hashes,
  archive_sha256: sha256(archive),
  archive_bytes: archive.length,
});
describe("bounded evidence packs", () => {
  it("reproduces all bytes and verifies every payload", () => {
    const a = pack(),
      b = pack();
    expect(a.archive.equals(b.archive)).toBe(true);
    expect(a.hashes).toEqual(b.hashes);
    expect(verifyEvidence(a.archive, a.hashes).files).toBe(
      Object.keys(a.members).length - 1,
    );
  });
  it("keeps exact decision snapshots separate from later repayment", () => {
    const d = load(),
      p = pack(d);
    const decision = Object.entries(p.members).find(
      ([k]) =>
        k.startsWith("decisions/") &&
        !k.includes("-cash") &&
        JSON.parse(p.members[k]).event.action === "approve",
    )!;
    const value = JSON.parse(decision[1]);
    expect(value.event).toEqual(d.events[2]);
    expect(value.actor.name).toBe("Treasury");
    expect(value.import_count).toBe(3);
    const cash = JSON.parse(
      p.members[decision[0].replace(".json", "-cash.json")],
    );
    expect(cash.formula_matches_recorded).toBe(true);
    expect(cash.post_snapshot_payouts).toEqual([]);
    expect(
      JSON.parse(p.members["repayment-history.json"]).allocations,
    ).toHaveLength(1);
  });
  it("excludes a later receipt from an earlier position", () => {
    const p = buildEvidence(load(), "advance-1", "2026-11-11T10:00:00Z");
    expect(JSON.parse(p.members["repayment-history.json"]).receipts).toEqual(
      [],
    );
    expect(JSON.parse(p.members["current-position.json"]).row.repaid).toBe("0");
  });
  for (const mode of ["decline", null] as const)
    it(`states no approval for ${mode ?? "import-only"} case`, () => {
      const p = pack(load(mode));
      expect(JSON.parse(p.members["decisions.json"]).approval_status).toMatch(
        /no Clearline/,
      );
    });
  it("keeps same-byte differently mapped cash imports separate", () => {
    let d = emptyFunding();
    for (const k of ["customers", "advances"] as ImportKind[])
      d = importCsv(
        d,
        k,
        readFileSync(`fixtures/funding/${k}.csv`, "utf8"),
        undefined,
        k,
        decisionAt,
      );
    const raw = readFileSync("fixtures/funding/cash.csv", "utf8")
      .trim()
      .split("\n");
    const text =
      raw
        .map((line, i) =>
          i === 0
            ? line + ",other_id,other_account"
            : line + `,other-${i},other-account`,
        )
        .join("\n") + "\n";
    const mapping = Object.fromEntries(columns.cash.map((k) => [k, k]));
    d = importCsv(d, "cash", text, mapping, "cash.csv", decisionAt);
    d = importCsv(
      d,
      "cash",
      text,
      { ...mapping, id: "other_id", account: "other_account" },
      "same.csv",
      decisionAt,
    );
    for (const action of ["users", "prepare", "approve"] as const)
      d = applyFundingEvent(d, {
        action,
        at: decisionAt,
        actor_id: action === "approve" ? "checker" : "maker",
        advance_id: "advance-1",
        reason: "Reviewed",
        users:
          action === "users"
            ? [
                { id: "maker", name: "Operator", role: "operator" },
                { id: "checker", name: "Treasury", role: "approver" },
              ]
            : [],
        import_count: d.imports.length,
        base_revision: d.revision,
      });
    const p = pack(d);
    const cashFiles = Object.entries(p.members)
      .filter(([name]) => name.endsWith("-cash.json"))
      .map(([, body]) => JSON.parse(body));
    expect(cashFiles.length).toBeGreaterThan(0);
    for (const cash of cashFiles) {
      expect(cash.buckets).toHaveLength(4);
      expect(
        cash.buckets.every(
          (row: { account: string }) => row.account === "provider-sgd",
        ),
      ).toBe(true);
      expect(cash.formula_matches_recorded).toBe(true);
    }
    expect(
      JSON.parse(p.members["inputs.json"]).filter(
        (b: { kind: string }) => b.kind === "cash",
      ),
    ).toHaveLength(2);
  });
  it("rejects unknown and not-yet-known advances", () => {
    expect(() => buildEvidence(load(), "missing", at)).toThrow(/No advance/);
    expect(() =>
      buildEvidence(load(), "advance-1", "2026-11-01T00:00:00Z"),
    ).toThrow(/No advance/);
  });
  it("rejects modified archive with trusted hashes", () => {
    const p = pack(),
      bytes = Buffer.from(p.archive);
    bytes[100] ^= 1;
    expect(() => verifyEvidence(bytes, p.hashes)).toThrow(/archive hash/);
  });
  for (const kind of ["changed", "missing", "extra"] as const)
    it(`detects ${kind} payload with a separately trusted manifest`, () => {
      const p = pack();
      const members: Record<string, string> = { ...p.members };
      if (kind === "changed") members["README.txt"] += "tamper";
      if (kind === "missing") delete members["README.txt"];
      if (kind === "extra") members["extra.txt"] = "extra";
      const zip = zipStored(members);
      expect(() => verifyEvidence(zip, changedArchive(zip, p.hashes))).toThrow(
        /payload/,
      );
    });
  it("rejects changed manifest even when archive checksum is updated", () => {
    const p = pack(),
      members = {
        ...p.members,
        "manifest.json": p.members["manifest.json"].replace(
          "clearline-evidence/v1",
          "clearline-evidence/v2",
        ),
      },
      zip = zipStored(members);
    expect(() => verifyEvidence(zip, changedArchive(zip, p.hashes))).toThrow(
      /manifest hash/,
    );
    expect(() =>
      verifyEvidence(zip, {
        ...changedArchive(zip, p.hashes),
        manifest_sha256: sha256(members["manifest.json"]),
      }),
    ).toThrow(/schema/);
  });
  it("rejects malformed CRC and ZIP bounds after outer hash update", () => {
    const p = pack();
    for (const offset of [14, 18, 0]) {
      const zip = Buffer.from(p.archive);
      zip[offset] ^= 1;
      expect(() =>
        verifyEvidence(zip, changedArchive(zip, p.hashes)),
      ).toThrow();
    }
  });
  it("rejects high-bit and traversal names without extracting them", () => {
    const p = pack();
    for (const name of [
      Buffer.from([0xd2, ...Buffer.from("EADME.txt")]),
      Buffer.from("../ME.txt"),
    ]) {
      const zip = Buffer.from(p.archive);
      let offset = zip.indexOf("README.txt");
      while (offset >= 0) {
        name.copy(zip, offset);
        offset = zip.indexOf("README.txt", offset + 10);
      }
      expect(() =>
        verifyEvidence(zip, changedArchive(zip, p.hashes)),
      ).toThrow();
    }
  });
  it("rejects duplicate member aliases", () => {
    const zip = zipStored({ "a.txt": "a", "b.txt": "b" });
    let offset = zip.indexOf("b.txt");
    while (offset >= 0) {
      zip.write("a.txt", offset);
      offset = zip.indexOf("b.txt", offset + 5);
    }
    expect(() =>
      verifyEvidence(zip, {
        format: "clearline-evidence-hashes/v1",
        archive_sha256: sha256(zip),
        manifest_sha256: "a".repeat(64),
        archive_bytes: zip.length,
      }),
    ).toThrow(/duplicate/);
  });
  it("uses generated safe paths instead of source filenames", () => {
    let d = emptyFunding();
    for (const k of ["customers", "advances", "cash"] as ImportKind[])
      d = importCsv(
        d,
        k,
        readFileSync(`fixtures/funding/${k}.csv`, "utf8"),
        undefined,
        `../${k}.csv`,
        decisionAt,
      );
    const p = pack(d);
    expect(Object.keys(p.members).some((n) => n.includes(".."))).toBe(false);
    expect(canonicalJson(JSON.parse(p.members["inputs.json"]))).toContain(
      "../customers.csv",
    );
    expect(() => verifyEvidence(p.archive, p.hashes)).not.toThrow();
  });
});
