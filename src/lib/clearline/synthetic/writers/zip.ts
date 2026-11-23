/**
 * Make a ZIP container (e.g. an .xlsx) byte-for-byte deterministic: JSZip stamps every entry with the current time,
 * so this rewrites the DOS time/date of each local header and central-directory entry to a fixed instant.
 */
export function dosDateTime(date: string): { time: number; date: number } {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7)), d = Number(date.slice(8, 10));
  return { time: 0, date: ((y - 1980) << 9) | (m << 5) | d };
}

const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
const put16 = (b: Uint8Array, at: number, v: number) => { b[at] = v & 0xff; b[at + 1] = (v >> 8) & 0xff; };

export interface ZipEntry { name: string; method: number; compressedSize: number; dataOffset: number; time: number; date: number }

/** List entries via the central directory (no decompression). */
export function zipEntries(bytes: Uint8Array): ZipEntry[] {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip: no end-of-central-directory record");
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (u32(bytes, p) !== 0x02014b50) throw new Error("bad central directory entry");
    const n = u16(bytes, p + 28), e = u16(bytes, p + 30), c = u16(bytes, p + 32);
    const local = u32(bytes, p + 42);
    const name = new TextDecoder().decode(bytes.slice(p + 46, p + 46 + n));
    const ln = u16(bytes, local + 26), le = u16(bytes, local + 28);
    out.push({ name, method: u16(bytes, p + 10), compressedSize: u32(bytes, p + 20), dataOffset: local + 30 + ln + le, time: u16(bytes, local + 10), date: u16(bytes, local + 12) });
    p += 46 + n + e + c;
  }
  return out;
}

export function normalizeZipTimes(input: Uint8Array, date: string): Uint8Array {
  const bytes = Uint8Array.from(input);
  const t = dosDateTime(date);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip: no end-of-central-directory record");
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  for (let i = 0; i < count; i++) {
    if (u32(bytes, p) !== 0x02014b50) throw new Error("bad central directory entry");
    put16(bytes, p + 12, t.time); put16(bytes, p + 14, t.date);
    const local = u32(bytes, p + 42);
    if (u32(bytes, local) !== 0x04034b50) throw new Error("bad local header");
    put16(bytes, local + 10, t.time); put16(bytes, local + 12, t.date);
    p += 46 + u16(bytes, p + 28) + u16(bytes, p + 30) + u16(bytes, p + 32);
  }
  return bytes;
}
