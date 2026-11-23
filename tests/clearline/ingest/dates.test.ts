import { describe, expect, it } from "vitest";
import { detectDateFormat, parseDate, parseDateColumn, type DateFormat } from "@/lib/clearline/ingest";

const SGT = { utcOffsetMinutes: 480 };
const get = (text: string, format: DateFormat, opts = SGT) => {
  const r = parseDate(text, format, opts);
  if (!r.ok) throw new Error(`${text}: ${r.message}`);
  return r.value;
};

describe("parseDate: formats", () => {
  it.each([
    ["2026-11-02", "iso"], ["2026/11/02", "iso"], ["02/11/2026", "dmy"], ["2.11.2026", "dmy"], ["02.11.2026", "dmy"],
    ["11/02/2026", "mdy"], ["11-02-2026", "mdy"], ["02-Nov-2026", "d_mon_y"], ["2 November 2026", "d_mon_y"], ["02-NOV-2026", "d_mon_y"],
  ] as const)("%s (%s) → 2026-11-02", (text, f) => expect(get(text, f).date).toBe("2026-11-02"));

  it("refuses impossible dates and the wrong format", () => {
    for (const [t, f] of [["2026-02-29", "iso"], ["31/04/2026", "dmy"], ["13/01/2026", "mdy"], ["2026-13-01", "iso"], ["02/11/26", "dmy"], ["02-Foo-2026", "d_mon_y"], ["2026-11-02", "dmy"]] as const) {
      expect(parseDate(t, f, SGT).ok, `${t} as ${f}`).toBe(false);
    }
    expect(get("2028-02-29", "iso").date).toBe("2028-02-29");
  });

  it("empty and invalid options", () => {
    expect(parseDate("", "iso", SGT)).toMatchObject({ ok: false, code: "empty" });
    expect(parseDate("2026-11-02", "iso", { utcOffsetMinutes: 2000 })).toMatchObject({ ok: false, code: "invalid_option" });
  });
});

describe("parseDate: times and offsets", () => {
  it("ISO with Z and with ±hh:mm offsets is normalised to a UTC instant", () => {
    expect(get("2026-11-02T10:15:30Z", "iso")).toMatchObject({ date: "2026-11-02", time: "10:15:30", instant: "2026-11-02T10:15:30.000Z", offsetMinutes: 0, offsetSource: "file" });
    expect(get("2026-11-02T10:15:30+08:00", "iso")).toMatchObject({ instant: "2026-11-02T02:15:30.000Z", offsetMinutes: 480, offsetSource: "file" });
    expect(get("2026-11-02T01:00:00-0530", "iso")).toMatchObject({ instant: "2026-11-02T06:30:00.000Z", offsetMinutes: -330 });
    expect(get("2026-11-02T10:15:30.123+04:00", "iso").instant).toBe("2026-11-02T06:15:30.123Z");
  });
  it("a datetime without an offset takes the default, and says so", () => {
    expect(get("2026-11-02 09:30", "iso")).toMatchObject({ time: "09:30:00", instant: "2026-11-02T01:30:00.000Z", offsetMinutes: 480, offsetSource: "default" });
    expect(get("02/11/2026 00:30:00", "dmy")).toMatchObject({ date: "2026-11-02", instant: "2026-11-01T16:30:00.000Z", offsetSource: "default" });
    expect(get("02-Nov-2026 23:59", "d_mon_y", { utcOffsetMinutes: 0 }).instant).toBe("2026-11-02T23:59:00.000Z");
  });
  it("a date-only value has no instant and no offset", () => {
    const d = get("2026-11-02", "iso");
    expect(d.instant).toBeUndefined();
    expect(d.offsetSource).toBeUndefined();
  });
  it("refuses impossible times, an offset without a time, and bad offsets", () => {
    for (const t of ["2026-11-02T24:00", "2026-11-02T10:60", "2026-11-02+08:00", "2026-11-02T10:00+15:00", "2026-11-02T10:00 PM"]) expect(parseDate(t, "iso", SGT).ok, t).toBe(false);
  });
  it("keeps the original text", () => expect(get(" 2026-11-02T10:00:00Z ", "iso").original).toBe(" 2026-11-02T10:00:00Z "));
});

describe("parseDate: Excel serial dates", () => {
  it.each([["1", "1900-01-01"], ["59", "1900-02-28"], ["61", "1900-03-01"], ["45658", "2025-01-01"], ["46328", "2026-11-02"]])("%s → %s", (s, d) =>
    expect(get(s, "excel_serial").date).toBe(d));
  it("reads the day fraction exactly, to the second", () => {
    expect(get("46328.5", "excel_serial", { utcOffsetMinutes: 0 })).toMatchObject({ date: "2026-11-02", time: "12:00:00", instant: "2026-11-02T12:00:00.000Z", offsetSource: "default" });
    expect(get("46328.75", "excel_serial").time).toBe("18:00:00");
    expect(get("46328.999999999", "excel_serial").date).toBe("2026-11-03"); // rounds up into the next day
  });
  it("refuses 29 Feb 1900 (Excel's invented day) and out-of-range serials", () => {
    expect(parseDate("60", "excel_serial", SGT)).toMatchObject({ ok: false });
    expect(parseDate("0", "excel_serial", SGT).ok).toBe(false);
    expect(parseDate("3000000", "excel_serial", SGT).ok).toBe(false);
    expect(parseDate("-5", "excel_serial", SGT).ok).toBe(false);
  });
});

describe("detectDateFormat: decided over ALL rows", () => {
  it("a day above 12 anywhere decides day-first", () => {
    expect(detectDateFormat(["01/02/2026", "03/04/2026", "25/12/2026"])).toMatchObject({ status: "decided", format: "dmy" });
  });
  it("a second field above 12 decides month-first", () => {
    expect(detectDateFormat(["01/02/2026", "12/31/2026", ""])).toMatchObject({ status: "decided", format: "mdy" });
  });
  it("all values ambiguous → ambiguous with both candidates, never a guess", () => {
    const d = detectDateFormat(["01/02/2026", "03/04/2026", "12.11.2026"]);
    expect(d).toEqual({ status: "ambiguous", candidates: ["dmy", "mdy"], examples: ["01/02/2026", "03/04/2026", "12.11.2026"] });
  });
  it("values that fit no single format are inconsistent, with the failing values", () => {
    const d = detectDateFormat(["13/01/2026", "01/13/2026"]);
    expect(d.status).toBe("inconsistent");
    if (d.status === "inconsistent") expect(d.failing.length).toBeGreaterThan(0);
    const e = detectDateFormat(["2026-11-02", "2026-11-03", "not a date"]);
    expect(e).toMatchObject({ status: "inconsistent", best: "iso", failing: [{ index: 2, value: "not a date" }] });
  });
  it("ISO, month names and Excel serials", () => {
    expect(detectDateFormat(["2026-11-02", "2026-11-03T10:00:00Z"])).toMatchObject({ status: "decided", format: "iso", hasTime: true, offsets: "some" });
    expect(detectDateFormat(["02-Nov-2026", "15-Dec-2026"])).toMatchObject({ status: "decided", format: "d_mon_y", hasTime: false, offsets: "none" });
    expect(detectDateFormat(["46328", "46329.5"])).toMatchObject({ status: "decided", format: "excel_serial" });
    expect(detectDateFormat(["", " "])).toEqual({ status: "empty" });
  });
  it("mixed offsets are flagged", () => {
    expect(detectDateFormat(["2026-11-02T10:00:00+08:00", "2026-11-02T10:00:00Z"])).toMatchObject({ status: "decided", offsets: "all", mixedOffsets: true });
  });
});

describe("parseDateColumn", () => {
  it("normalises mixed time zones to UTC instants and keeps each original", () => {
    const values = ["2026-11-02T10:00:00+08:00", "2026-11-02T02:00:00Z", "2026-11-01T22:00:00-04:00", "2026-11-02 10:00", ""];
    const r = parseDateColumn(values, SGT);
    expect(r.status).toBe("parsed");
    if (r.status !== "parsed") return;
    const ok = r.values.map((v) => (v && v.ok ? v.value : null));
    expect(ok.slice(0, 4).map((v) => v?.instant)).toEqual(Array(4).fill("2026-11-02T02:00:00.000Z"));
    expect(ok.slice(0, 4).map((v) => v?.original)).toEqual(values.slice(0, 4));
    expect(ok.slice(0, 4).map((v) => v?.offsetSource)).toEqual(["file", "file", "file", "default"]);
    expect(ok[2]?.date).toBe("2026-11-01"); // the calendar date as written, in its own offset
    expect(r.values[4]).toBeNull();
  });
  it("returns the detection instead of values when the order is ambiguous", () => {
    expect(parseDateColumn(["01/02/2026"], SGT)).toMatchObject({ status: "ambiguous" });
  });
  it("an explicit format resolves the ambiguity", () => {
    const r = parseDateColumn(["01/02/2026"], { ...SGT, format: "mdy" });
    expect(r.status === "parsed" && r.values[0]?.ok && r.values[0].value.date).toBe("2026-01-02");
  });
});
