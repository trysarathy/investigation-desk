import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { monthPreset, statementFor, type Preset } from "@/lib/clearline/synthetic";
import { euroMinor, parseCsv, plainMinor, text, xmlWellFormed } from "./helpers";

let p: Preset;
beforeAll(async () => { p = await monthPreset(); }, 60_000);
const file = (kind: string, account?: string) => p.files.find((f) => f.kind === kind && (!account || f.account === account))!;

describe("synthetic bank statements", () => {
  it("statement model: opening + entries = closing, for every account", () => {
    for (const a of p.world.bankAccounts) {
      const st = statementFor(p.world, a.accountId);
      expect(st.entries.length).toBeGreaterThan(20);
      expect(st.openingMinor + st.entries.reduce((t, e) => t + e.line.amountMinor, 0n)).toBe(st.closingMinor);
      expect(st.entries.some((e) => e.line.amountMinor < 0n)).toBe(true);
    }
  });

  it("MT940: valid field layout; each :60F: + :61: entries = :62F:, and balances chain from statement to statement", () => {
    for (const a of p.world.bankAccounts) {
      const st = statementFor(p.world, a.accountId);
      const body = text(file("bank_mt940", a.accountId).bytes);
      const msgs = body.split("\r\n-\r\n").filter((m) => m.trim());
      let prev: bigint | null = null;
      let entries = 0;
      for (const m of msgs) {
        const lines = m.split("\r\n");
        expect(lines[0]).toMatch(/^:20:[A-Z0-9]{1,16}$/);
        expect(lines[1]).toBe(`:25:${a.accountId}`);
        expect(lines[2]).toMatch(/^:28C:\d{5}\/001$/);
        const bal = (tag: string) => {
          const mm = new RegExp(`^:${tag}:([CD])(\\d{6})${a.currency}(\\d+,\\d{2})$`).exec(lines.find((l) => l.startsWith(`:${tag}:`))!);
          expect(mm, tag).not.toBeNull();
          return (mm![1] === "D" ? -1n : 1n) * plainMinor(mm![3]);
        };
        const open = bal("60F"), close = bal("62F");
        if (prev !== null) expect(open).toBe(prev);
        else expect(open).toBe(st.openingMinor);
        let sum = 0n;
        for (const l of lines.filter((x) => x.startsWith(":61:"))) {
          const mm = /^:61:(\d{6})(\d{4})([CD])(\d+,\d{2})N[A-Z]{3}([^/]{1,16})\/\/(.{1,16})$/.exec(l);
          expect(mm, l).not.toBeNull();
          sum += (mm![3] === "D" ? -1n : 1n) * plainMinor(mm![4]);
          entries++;
        }
        for (const l of lines) if (!l.startsWith(":")) expect(l.length).toBeLessThanOrEqual(65);
        expect(open + sum).toBe(close);
        prev = close;
      }
      expect(prev).toBe(st.closingMinor);
      expect(entries).toBe(st.entries.length);
    }
  });

  it("camt.053.001.08: well-formed XML; OPBD + booked entries = CLBD; RmtInf/Ustrd carries the batch reference", () => {
    for (const a of p.world.bankAccounts) {
      const xml = text(file("bank_camt053", a.accountId).bytes);
      expect(xmlWellFormed(xml)).toEqual({ ok: true, root: "Document" });
      expect(xml).toContain('xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"');
      const bal = (code: string) => {
        const m = new RegExp(`<Cd>${code}</Cd></CdOrPrtry></Tp>\\s*<Amt Ccy="${a.currency}">([\\d.]+)</Amt>\\s*<CdtDbtInd>(CRDT|DBIT)</CdtDbtInd>`).exec(xml)!;
        return (m[2] === "DBIT" ? -1n : 1n) * plainMinor(m[1]);
      };
      const ntries = [...xml.matchAll(/<Ntry>([\s\S]*?)<\/Ntry>/g)].map((m) => m[1]);
      let sum = 0n;
      for (const n of ntries) {
        expect(n).toContain("<Sts><Cd>BOOK</Cd></Sts>");
        expect(n).toMatch(/<ValDt><Dt>\d{4}-\d{2}-\d{2}<\/Dt><\/ValDt>/);
        expect(n).toMatch(/<AcctSvcrRef>[A-Z0-9]+<\/AcctSvcrRef>/);
        const m = /<Amt Ccy="[A-Z]{3}">([\d.]+)<\/Amt>\s*<CdtDbtInd>(CRDT|DBIT)<\/CdtDbtInd>/.exec(n)!;
        sum += (m[2] === "DBIT" ? -1n : 1n) * plainMinor(m[1]);
      }
      expect(bal("OPBD") + sum).toBe(bal("CLBD"));
      const batches = p.world.batches.filter((b) => b.targetBankAccount === a.accountId);
      for (const b of batches) expect(xml).toContain(`<RmtInf><Ustrd>${b.batchId}</Ustrd></RmtInf>`);
    }
  });

  it("bank CSV: semicolons, DD.MM.YYYY, decimal comma, brackets for negatives, running balance consistent", () => {
    for (const a of p.world.bankAccounts) {
      const rows = parseCsv(text(file("bank_csv", a.accountId).bytes), ";").filter((r) => r.length > 1);
      expect(rows[0]).toEqual(["Booking Date", "Value Date", "Bank Reference", "Description", "Amount", "Currency", "Balance"]);
      let bal = statementFor(p.world, a.accountId).openingMinor;
      for (const r of rows.slice(1)) {
        expect(r[1]).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
        expect(r[4]).toMatch(/^\(?\d{1,3}(\.\d{3})*,\d{2}\)?$/);
        bal += euroMinor(r[4]);
        expect(euroMinor(r[6])).toBe(bal);
      }
      expect(rows.slice(1).some((r) => r[4].startsWith("("))).toBe(true);
    }
  });
});

describe("synthetic provider and order files", () => {
  it("shape A: UTF-8 BOM, comma CSV, DD/MM/YYYY HH:mm, thousand separators, TOTAL row equal to the sum", () => {
    for (const f of p.files.filter((x) => x.kind === "provider_export_a")) {
      expect([...f.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      const rows = parseCsv(text(f.bytes)).filter((r) => r.length > 1);
      expect(rows[0].slice(0, 11)).toEqual(["Order Ref", "Quote", "Amount Quoted", "Amount Received", "Asset", "Chain", "Tx Hash", "From", "Status", "Settled In", "Created (SGT)"]);
      const body = rows.slice(1, -1), total = rows[rows.length - 1];
      expect(total[0]).toBe("TOTAL");
      expect(body.every((r) => /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(r[10]))).toBe(true);
      expect(body.some((r) => /^\d{1,3}(,\d{3})+\.\d{2}$/.test(r[15]))).toBe(true);
      const sum = body.reduce((t, r) => t + plainMinor(r[15].replace(/,/g, "")), 0n);
      expect(plainMinor(total[15].replace(/,/g, ""))).toBe(sum);
      expect(total[8]).toBe(`${body.length} payments`);
    }
  });

  it("shape B: xlsx with snake_case headers, numeric amount cells, MM/DD/YYYY and ISO datetimes with mixed offsets", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(file("provider_export_b").bytes) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("payments")!;
    const header = (ws.getRow(1).values as unknown[]).slice(1);
    expect(header.slice(0, 13)).toEqual(["merchant_order_id", "payment_id", "reference", "crypto_amount", "fiat_credited", "currency", "network", "transaction_hash", "deposit_address", "payer_wallet", "payment_status", "batch", "fee"]);
    expect(ws.rowCount - 1).toBe(p.world.providerRecords.length);
    const offs = new Set<string>();
    for (let i = 2; i <= ws.rowCount; i++) {
      const r = ws.getRow(i);
      expect(typeof r.getCell(4).value).toBe("number");
      expect(typeof r.getCell(5).value).toBe("number");
      expect(String(r.getCell(15).value)).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
      offs.add(/(Z|[+-]\d{2}:\d{2})$/.exec(String(r.getCell(16).value))![1]);
    }
    expect(offs).toEqual(new Set(["+08:00", "+04:00", "Z"]));
  });

  it("shape C: nested records with string amounts, and a settlement report with totals only", () => {
    const c = JSON.parse(text(file("provider_export_c").bytes));
    expect(c.data).toHaveLength(p.world.providerRecords.length);
    for (const d of c.data.slice(0, 50)) {
      expect(Object.keys(d)).toEqual(["order", "pay", "chain", "settlement"]);
      expect(typeof d.order.id).toBe("string");
      expect(d.pay.amount).toMatch(/^\d+\.\d{6}$/);
      expect(d.pay.credited).toMatch(/^\d+\.\d{2}$/);
    }
    const totals = JSON.parse(text(file("provider_settlement_totals_c").bytes));
    expect(totals.settlements).toHaveLength(p.world.batches.length);
    for (const s of totals.settlements) {
      expect(Object.keys(s.totals)).toEqual(["gross", "fees", "refunds", "net"]);
      expect(JSON.stringify(s)).not.toMatch(/PAY-/); // no per-payment lines
    }
  });

  it("settlement reports: per-payment lines sum to each batch's gross and refunds; totals JSON matches the batches", () => {
    const rows = parseCsv(text(file("settlement_lines").bytes)).filter((r) => r.length > 1).slice(1);
    for (const b of p.world.batches) {
      const mine = rows.filter((r) => r[0] === b.batchId);
      expect(mine.filter((r) => r[3] === "payment").reduce((t, r) => t + plainMinor(r[7]), 0n)).toBe(b.grossMinor);
      expect(-mine.filter((r) => r[3] === "refund").reduce((t, r) => t + BigInt(r[7].replace(".", "")), 0n)).toBe(b.refundsMinor);
    }
    const totals = JSON.parse(text(file("settlement_totals").bytes));
    for (const t of totals.batches) {
      const b = p.world.batches.find((x) => x.batchId === t.batch_id)!;
      expect([t.gross, t.fees, t.refunds, t.net].map(plainMinor)).toEqual([b.grossMinor, b.feesMinor, b.refundsMinor, b.netMinor]);
      expect(b.grossMinor - b.feesMinor - b.refundsMinor).toBe(b.netMinor);
    }
  });

  it("order list: CSV and XLSX carry every order", async () => {
    const rows = parseCsv(text(file("order_list_csv").bytes)).filter((r) => r.length > 1);
    expect(rows.length - 1).toBe(p.world.orders.length);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(file("order_list_xlsx").bytes) as unknown as ArrayBuffer);
    expect(wb.getWorksheet("orders")!.rowCount - 1).toBe(p.world.orders.length);
  });
});
