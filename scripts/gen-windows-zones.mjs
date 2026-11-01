// Regenerates src/lib/accounting/windows-zones.ts from Unicode CLDR's windowsZones.xml.
//
//   curl -sSo /some/dir/windowsZones.xml https://raw.githubusercontent.com/unicode-org/cldr/main/common/supplemental/windowsZones.xml
//   node scripts/gen-windows-zones.mjs /some/dir/windowsZones.xml 2026-11-01 > src/lib/accounting/windows-zones.ts
//
// The second argument is the date the XML was downloaded (it goes in the header). Then run
// `npx vitest run tests/org-timezone.test.ts`: it checks every IANA zone in the table is one Node knows.
// The "139 of 141" count in the header was checked against Xero's TimeZone enum (Xero OpenAPI 19.1.0);
// re-check it by hand if CLDR adds or renames Windows zones.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const [file, downloaded] = process.argv.slice(2);
if (!file || !/^\d{4}-\d{2}-\d{2}$/.test(downloaded ?? "")) {
  console.error("usage: node scripts/gen-windows-zones.mjs <windowsZones.xml> <YYYY-MM-DD downloaded>");
  process.exit(2);
}
const xml = readFileSync(file);
const text = xml.toString("utf8");
const sha = createHash("sha256").update(xml).digest("hex");
const versions = text.match(/<mapTimezones\s+otherVersion="([^"]+)"\s+typeVersion="([^"]+)"/);
if (!versions) throw new Error("No <mapTimezones otherVersion=… typeVersion=…> in the file.");
const [, otherVersion, typeVersion] = versions;

// Xero's normalisation of a Windows name: spaces, dots and hyphens removed, upper-cased.
const norm = (name) => name.replace(/[\s.-]/g, "").toUpperCase();
const rows = new Map();
for (const m of text.matchAll(/<mapZone other="([^"]+)" territory="001" type="([^"]+)"\/>/g)) {
  const [, windows, iana] = m;
  const key = norm(windows);
  if (rows.has(key)) throw new Error(`Two Windows names normalise to ${key}.`);
  rows.set(key, { iana: iana.split(" ")[0], windows });
}
if (rows.size < 130) throw new Error(`Only ${rows.size} territory-001 entries: is this the right file?`);

const out = [
  `// GENERATED, do not edit by hand. Windows timezone names → IANA zones, from Unicode CLDR`,
  `// common/supplemental/windowsZones.xml (mapTimezones typeVersion="${typeVersion}", otherVersion="${otherVersion}"),`,
  `// territory "001" (the zone Windows uses for the name), downloaded ${downloaded} from`,
  `// https://raw.githubusercontent.com/unicode-org/cldr/main/common/supplemental/windowsZones.xml`,
  `// (sha256 ${sha}).`,
  `// Keys are CLDR's Windows names normalised the way Xero writes \`Organisation.Timezone\`: spaces,`,
  `// dots and hyphens removed, upper-cased ("Singapore Standard Time" → SINGAPORESTANDARDTIME,`,
  `// "UTC-02" → UTC02). 139 of the 141 values in Xero's TimeZone enum (Xero OpenAPI 19.1.0) are here;`,
  `// KAMCHATKASTANDARDTIME and MIDATLANTICSTANDARDTIME are not in CLDR, so they stay unmapped and a`,
  `// plan for such an organisation is blocked (never guessed, never UTC).`,
  ``,
  `export const WINDOWS_TO_IANA: Readonly<Record<string, string>> = {`,
  ...[...rows.keys()].sort().map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(rows.get(k).iana)}, // ${rows.get(k).windows}`),
  `};`,
  ``,
];
process.stdout.write(out.join("\n"));
