/**
 * A minimal ZIP writer (STORE method, no compression) for export packs. Pure and deterministic: every entry carries
 * the same fixed DOS date, so the same files always give the same bytes (and the same SHA-256).
 */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();

export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipFile { name: string; data: Uint8Array | string }

/** Files → one ZIP archive. Names are plain relative paths (no "..", no leading slash), at most 200 characters. */
export function storeZip(files: ZipFile[], date = "2026-01-01"): Uint8Array {
  const enc = new TextEncoder();
  const dosDate = ((Number(date.slice(0, 4)) - 1980) << 9) | (Number(date.slice(5, 7)) << 5) | Number(date.slice(8, 10));
  const local: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  const seen = new Set<string>();
  for (const f of files) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(f.name) || f.name.includes("..") || seen.has(f.name)) throw new Error(`invalid or repeated zip entry name: ${f.name}`);
    seen.add(f.name);
    const name = enc.encode(f.name), data = typeof f.data === "string" ? enc.encode(f.data) : f.data, crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, 0, true); h.setUint16(12, dosDate, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, 0, true); c.setUint16(14, dosDate, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    local.push(new Uint8Array(h.buffer), name, data);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s, x) => s + x.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
  const parts = [...local, ...central, new Uint8Array(e.buffer)];
  const out = new Uint8Array(parts.reduce((s, x) => s + x.length, 0));
  let p = 0;
  for (const x of parts) { out.set(x, p); p += x.length; }
  return out;
}

/** Read a STORE-only archive written by storeZip (for tests and checks). */
export function readStoreZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Map<string, Uint8Array>();
  let p = 0;
  while (p + 30 <= bytes.length && v.getUint32(p, true) === 0x04034b50) {
    if (v.getUint16(p + 8, true) !== 0) throw new Error("compressed entries are not supported");
    const size = v.getUint32(p + 18, true), n = v.getUint16(p + 26, true), x = v.getUint16(p + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + n));
    const data = bytes.slice(p + 30 + n + x, p + 30 + n + x + size);
    if (crc32(data) !== v.getUint32(p + 14, true)) throw new Error(`bad CRC for ${name}`);
    out.set(name, data);
    p += 30 + n + x + size;
  }
  return out;
}
