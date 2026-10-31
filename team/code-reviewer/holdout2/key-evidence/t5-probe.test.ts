import { describe, it } from "vitest";
import { friendlyTime } from "@/lib/requests/ui";
describe("probe", () => { it("p", () => {
  const cases: [string, string][] = [
    ["2026-10-31T15:50:00Z", "2026-10-31T16:10:00Z"], // 23:50 SGT Sat seen at 00:10 SGT Sun
    ["2026-10-31T01:00:00Z", "2026-11-01T00:00:00Z"], // 09:00 SGT Sat seen at 08:00 SGT Sun
    ["2026-10-25T13:00:00Z", "2026-11-01T00:00:00Z"], // Sun 25 Oct 21:00 SGT seen Sun 1 Nov 08:00
    ["2026-11-01T00:03:00Z", "2026-11-01T00:00:00Z"], // 3 minutes in the future (clock skew)
  ];
  for (const [iso, now] of cases) console.log("PROBE", iso, "@", now, "=>", friendlyTime(iso, Date.parse(now)));
}); });
