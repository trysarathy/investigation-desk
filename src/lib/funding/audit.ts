import { createHash } from "node:crypto";
export type AuditActor = {
  kind: "user" | "local_admin" | "system";
  id: string;
};
export interface AuditInput {
  actor: AuditActor;
  action: string;
  details: Record<string, unknown>;
}
export interface AuditEntry extends AuditInput {
  sequence: number;
  recorded_at: string;
  previous_hash: string;
  data_sha256: string;
  hash: string;
}
export interface AuditAnchor {
  format: "clearline-audit-anchor/v1";
  sequence: number;
  hash: string;
}
export const canonical = (value: unknown): string => {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, x]) => [k, sort(x)]),
          )
        : v;
  return JSON.stringify(sort(value));
};
export const hash = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export function validateAuditInput(input: AuditInput) {
  if (
    !input ||
    !input.actor ||
    !["user", "local_admin", "system"].includes(input.actor.kind) ||
    typeof input.actor.id !== "string" ||
    !input.actor.id ||
    input.actor.id.length > 200 ||
    /[\u0000-\u001f]/.test(input.actor.id) ||
    typeof input.action !== "string" ||
    !/^[a-z_]{1,60}$/.test(input.action) ||
    !input.details ||
    typeof input.details !== "object" ||
    Array.isArray(input.details) ||
    Buffer.byteLength(canonical(input.details)) > 1000000
  )
    throw Error("Invalid audit metadata.");
}
export function appendAudit(
  entries: AuditEntry[],
  input: AuditInput,
  data: unknown,
): AuditEntry[] {
  validateAuditInput(input);
  const body = {
    ...input,
    sequence: entries.length + 1,
    recorded_at: new Date().toISOString(),
    previous_hash: entries.at(-1)?.hash ?? "0".repeat(64),
    data_sha256: hash(data),
  };
  return [...entries, { ...body, hash: hash(body) }];
}
export function verifyAudit(
  entries: AuditEntry[],
  data: unknown,
  anchor?: AuditAnchor,
) {
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 100000)
    throw Error("Invalid audit length.");
  let previous = "0".repeat(64);
  entries.forEach((entry, i) => {
    validateAuditInput(entry);
    if (
      Object.keys(entry).sort().join(",") !==
        "action,actor,data_sha256,details,hash,previous_hash,recorded_at,sequence" ||
      entry.sequence !== i + 1 ||
      entry.previous_hash !== previous ||
      typeof entry.recorded_at !== "string" ||
      !Number.isFinite(Date.parse(entry.recorded_at)) ||
      !/^[a-f0-9]{64}$/.test(entry.data_sha256)
    )
      throw Error("Audit chain metadata differs.");
    const body = {
      actor: entry.actor,
      action: entry.action,
      details: entry.details,
      sequence: entry.sequence,
      recorded_at: entry.recorded_at,
      previous_hash: entry.previous_hash,
      data_sha256: entry.data_sha256,
    };
    if (hash(body) !== entry.hash) throw Error("Audit entry hash differs.");
    previous = entry.hash;
  });
  if (entries.at(-1)!.data_sha256 !== hash(data))
    throw Error("Audit head does not bind these funding records.");
  if (
    anchor &&
    (anchor.format !== "clearline-audit-anchor/v1" ||
      !Number.isSafeInteger(anchor.sequence) ||
      anchor.sequence < 1 ||
      entries[anchor.sequence - 1]?.hash !== anchor.hash)
  )
    throw Error("Audit does not contain the trusted anchor.");
  return {
    format: "clearline-audit-anchor/v1" as const,
    sequence: entries.length,
    hash: previous,
  };
}
