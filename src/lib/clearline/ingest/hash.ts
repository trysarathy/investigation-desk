/**
 * Content hashes. The only file in the ingest module that imports a Node built-in (node:crypto), so every other file
 * stays usable in a browser.
 */
import { createHash } from "node:crypto";

/** Hex SHA-256 of the raw upload bytes: the same file uploaded twice has the same hash. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A cell as compared for duplicates: Unicode NFC, outer whitespace trimmed, inner whitespace runs collapsed to one space. */
export function normaliseCell(cell: string): string {
  return cell.normalize("NFC").replace(/\s+/g, " ").trim();
}

/**
 * Stable hash of one row's cells, after normalisation. The cells are encoded as a JSON array, so ["a,b"] and
 * ["a", "b"] differ; column order matters.
 */
export function rowHash(cells: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(cells.map(normaliseCell)), "utf8").digest("hex");
}
