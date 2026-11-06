import { createHash } from "node:crypto";
const xml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function zipStored(files: Record<string, string | Buffer>): Buffer {
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  const entries = Object.entries(files).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  if (entries.length > 65535) throw Error("Too many archive members.");
  for (const [name, content] of entries) {
    if (
      !/^[A-Za-z0-9_./\[\]-]+$/.test(name) ||
      name.startsWith("/") ||
      name.split("/").includes("..")
    )
      throw Error("Invalid archive member.");
    const filename = Buffer.from(name);
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
    if (bytes.length > 0xffffffff) throw Error("Archive member too large.");
    const crc = crc32(bytes);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(33, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(bytes.length, 18);
    head.writeUInt32LE(bytes.length, 22);
    head.writeUInt16LE(filename.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(33, 14);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(bytes.length, 20);
    directory.writeUInt32LE(bytes.length, 24);
    directory.writeUInt16LE(filename.length, 28);
    directory.writeUInt32LE(offset, 42);
    local.push(head, filename, bytes);
    central.push(directory, filename);
    offset += head.length + filename.length + bytes.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
export function workbook(
  headers: string[],
  rows: Record<string, string>[],
  numeric: Set<string>,
) {
  if (headers.length > 16384 || rows.length > 1048575)
    throw Error(
      "XLSX exceeds worksheet size limits. Use the exact CSV export instead.",
    );
  const letter = (index: number) => {
    let out = "";
    for (let n = index + 1; n; n = Math.floor((n - 1) / 26))
      out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
    return out;
  };
  const data = [Object.fromEntries(headers.map((h) => [h, h])), ...rows];
  const sheet = data
    .map(
      (row, r) =>
        `<row r="${r + 1}">${headers
          .map((h, c) => {
            const value = row[h] ?? "";
            if (
              value.length > 32767 ||
              [...value].some((char) => {
                const code = char.codePointAt(0)!;
                return (
                  (code >= 0xd800 && code <= 0xdfff) ||
                  (code & 0xffff) >= 0xfffe
                );
              })
            )
              throw Error(
                "XLSX contains unsupported text. Use CSV and correct the source text before a workbook export.",
              );
            const ref = `${letter(c)}${r + 1}`;
            if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))
              throw Error("Unsupported XML control character.");
            if (r && numeric.has(h)) {
              if (
                !/^\d+(\.\d{1,2})?$/.test(value) ||
                value.replace(".", "").replace(/^0+/, "").length > 15
              )
                throw Error(
                  "XLSX would exceed Excel’s 15-digit precision. Use the exact CSV export instead.",
                );
              return `<c r="${ref}"><v>${value}</v></c>`;
            }
            return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
          })
          .join("")}</row>`,
    )
    .join("");
  const files = {
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    "_rels/.rels":
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml":
      '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Open advances" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`,
  };
  return {
    bytes: zipStored(files),
    members: files,
    manifest: Object.fromEntries(
      Object.entries(files).map(([name, body]) => [
        name,
        createHash("sha256").update(body).digest("hex"),
      ]),
    ),
  };
}
