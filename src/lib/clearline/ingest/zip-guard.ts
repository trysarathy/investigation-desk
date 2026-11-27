/**
 * v1 phase 2.1: a zip container is inspected BEFORE an Excel reader opens it. The central directory is read, every
 * entry is inflated here with a hard output cap (node:zlib `maxOutputLength`), and the file is refused when:
 *  - it is not a plain zip (ZIP64, multi-disk, encrypted entries, methods other than stored/deflate),
 *  - an entry's real size differs from what the directory says (a lying header is how zip bombs evade checks),
 *  - one entry or all entries together inflate beyond the caps below (zip bomb), or there are too many entries,
 *  - two entries share a name, or a local header disagrees with the directory (zip confusion),
 *  - any XML part declares a DOCTYPE or ENTITY (billion laughs / XXE inside the workbook),
 *  - the workbook carries macros (a vbaProject.bin part).
 * Only after this check is the workbook handed to exceljs. Pure apart from zlib: no disk, no network.
 */
import { inflateRawSync } from "node:zlib";
import { IngestError } from "./errors";

export interface ZipLimits {
  /** Most entries in one container. A workbook has tens; 2,000 leaves room for many sheets and images. */
  maxEntries: number;
  /** Largest inflated size of one entry. */
  maxEntryBytes: number;
  /** Largest inflated size of all entries together. */
  maxTotalBytes: number;
}

/**
 * [ASSUMPTION] 128 MB inflated in total: a 100,000-row, 50-column sheet is about 80 MB of XML; anything larger is
 * refused as a probable zip bomb (the file limit is 20 MB compressed). Lower it, never raise it without review.
 */
export const ZIP_LIMITS: Readonly<ZipLimits> = Object.freeze({ maxEntries: 2_000, maxEntryBytes: 128 * 1024 * 1024, maxTotalBytes: 128 * 1024 * 1024 });

export interface ZipEntryInfo { name: string; compressedSize: number; size: number }

const EOCD = 0x06054b50;
const CDH = 0x02014b50;
const LFH = 0x04034b50;

const refuse = (message: string): never => { throw new IngestError("invalid_xlsx", message); };
const bomb = (message: string): never => { throw new IngestError("unsafe_zip", message); };

/** Read the central directory and inflate every entry under the caps. Returns the entries (names and sizes only). */
export function checkZipContainer(bytes: Uint8Array, limits: ZipLimits = ZIP_LIMITS): ZipEntryInfo[] {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length < 22) refuse("The Excel file is damaged (too short to be a zip file).");
  // End of central directory: the last 22 bytes, plus up to 65,535 bytes of comment.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) refuse("The Excel file is damaged (no zip directory).");
  const disk = buf.readUInt16LE(eocd + 4), cdDisk = buf.readUInt16LE(eocd + 6);
  const onDisk = buf.readUInt16LE(eocd + 8), total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12), cdOffset = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) bomb("ZIP64 containers are not accepted for Excel uploads.");
  if (disk !== 0 || cdDisk !== 0 || onDisk !== total) refuse("Multi-part zip files are not accepted.");
  if (total > limits.maxEntries) bomb(`The Excel file has ${total} parts; at most ${limits.maxEntries} are accepted.`);
  if (cdOffset + cdSize > eocd) refuse("The Excel file is damaged (zip directory out of range).");

  const entries: ZipEntryInfo[] = [];
  const names = new Set<string>();
  let totalBytes = 0;
  let p = cdOffset;
  for (let n = 0; n < total; n++) {
    if (p + 46 > eocd || buf.readUInt32LE(p) !== CDH) refuse("The Excel file is damaged (zip directory entry).");
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("latin1", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (flags & 0x1) bomb("Encrypted (password-protected) Excel files are not accepted. Remove the password and upload again.");
    if (method !== 0 && method !== 8) bomb("The Excel file uses an unsupported zip compression method.");
    if (csize === 0xffffffff || usize === 0xffffffff) bomb("ZIP64 containers are not accepted for Excel uploads.");
    if (/(^|\/)vbaProject\.bin$/i.test(name)) bomb("Macro-enabled workbooks are not accepted. Save the file as a plain .xlsx workbook and upload it again.");
    if (names.has(name)) bomb("The Excel file contains two parts with the same name.");
    names.add(name);
    if (usize > limits.maxEntryBytes) bomb("A part of the Excel file is too large once unpacked (probable zip bomb).");
    totalBytes += usize;
    if (totalBytes > limits.maxTotalBytes) bomb("The Excel file is too large once unpacked (probable zip bomb).");
    // the local header must agree with the directory
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== LFH) refuse("The Excel file is damaged (zip entry header).");
    const lNameLen = buf.readUInt16LE(local + 26), lExtraLen = buf.readUInt16LE(local + 28);
    if (buf.toString("latin1", local + 30, local + 30 + lNameLen) !== name) bomb("The Excel file's zip headers disagree with each other.");
    const start = local + 30 + lNameLen + lExtraLen;
    if (start + csize > buf.length) refuse("The Excel file is damaged (zip entry out of range).");
    const data = buf.subarray(start, start + csize);
    let out: Buffer;
    if (method === 0) out = data;
    else {
      try {
        // one byte more than declared: an entry that inflates beyond its declared size fails here, not in exceljs
        out = inflateRawSync(data, { maxOutputLength: Math.max(1, Math.min(usize + 1, limits.maxEntryBytes + 1)) });
      } catch (e) {
        if ((e as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") bomb("A part of the Excel file unpacks to more than it declares (probable zip bomb).");
        refuse("The Excel file is damaged (a part cannot be unpacked).");
      }
      out = out!;
    }
    if (out.length !== usize) bomb("A part of the Excel file is not the size its zip header declares.");
    if (/\.(xml|rels|vml)$/i.test(name) && /<!(DOCTYPE|ENTITY)/i.test(out.toString("latin1"))) {
      throw new IngestError("unsafe_xml", "The Excel file declares XML entities (DOCTYPE/ENTITY), which a workbook never needs; it was refused for safety.");
    }
    entries.push({ name, compressedSize: csize, size: usize });
  }
  return entries;
}
