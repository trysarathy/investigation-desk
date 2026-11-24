/**
 * `npm run demo:files` — writes demo-files/: what Northwind Travel's Singapore book receives on the demo day
 * (2026-12-08, the day after the seeded window), for the upload part of the demo. Deterministic and fictional
 * (src/lib/clearline/demo/next-day.ts); the files are committed, and the recorded chain file `npm run demo` writes
 * already holds their transfers.
 *
 *   provider-p-payments-2026-12-08.csv   Provider P's export in a layout Clearline has no template for: its own headers
 *                                        and order, "08-Dec-2026 08:12:33" Singapore times, quote terms and each
 *                                        payment's credit and fee. Mapped with the generic mapping screen.
 *   northwind-sgd-statement-2026-12-08.camt053.xml   the SGD account's camt.053 for the day (needs no mapping;
 *                                        imported, not bank-authenticated)
 *   northwind-sg-bookings-2026-12-08.xlsx  the day's bookings (order list) as a spreadsheet
 *   expected-outcomes.json               written by tests/control/demo-files.test.ts (CLEARLINE_DEMO_FILES_RECORD=1)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { demoWorld } from "../../src/lib/clearline/demo/world";
import { demoNextDay, type NextDay } from "../../src/lib/clearline/demo/next-day";
import { DEMO_TODAY } from "../../src/lib/clearline/demo/clock";
import { normalizeZipTimes } from "../../src/lib/clearline/synthetic/writers/zip";

export const DEMO_FILES_DIR = path.resolve(__dirname, "../../demo-files");
export const FILES = {
  provider: `provider-p-payments-${DEMO_TODAY}.csv`,
  bank: `northwind-sgd-statement-${DEMO_TODAY}.camt053.xml`,
  orders: `northwind-sg-bookings-${DEMO_TODAY}.xlsx`,
} as const;

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "08-Dec-2026 08:12:33" in Singapore time (no offset written: the mapping supplies +08:00). */
const sgt = (iso: string) => {
  const d = new Date(Date.parse(iso) + 8 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}-${MON[d.getUTCMonth()]}-${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
};
const money = (minor: bigint) => `${minor < 0n ? "-" : ""}${(minor < 0n ? -minor : minor) / 100n}.${String((minor < 0n ? -minor : minor) % 100n).padStart(2, "0")}`;
const coins = (base: bigint) => `${base / 1_000_000n}.${String(base % 1_000_000n).padStart(6, "0").replace(/0{1,4}$/, "")}`;
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const xml = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const PROVIDER_HEADERS = [
  "Txn No.", "Booking Ref", "Checkout Ref", "Order total (SGD)", "Chain", "Coin", "Coin contract", "Pay-to wallet", "Payer wallet",
  "Coins expected", "Coins received", "Offer price", "Fill price", "Net to merchant", "Charge", "Result", "On-chain ref", "Log #",
  "Offer opened (SGT)", "Offer ends (SGT)", "Paid (SGT)", "Payout ref",
] as const;

export function providerCsv(n: NextDay): string {
  const rows = n.payments.map((p) => [
    p.paymentId, p.orderId, p.quoteId, money(p.invoiceMinor), p.network === "tron" ? "TRC20" : "ERC20", p.symbol, p.contract, p.depositAddress, p.payer,
    coins(p.quotedBaseUnits), coins(p.receivedBaseUnits), p.quoteRate, p.executedRate, money(p.creditedMinor), money(p.feeMinor), p.status, p.txHash, String(p.logIndex),
    sgt(p.quoteCreatedAt), sgt(p.quoteExpiresAt), sgt(p.paidAt), "", // not settled yet: tomorrow's payout
  ]);
  return [PROVIDER_HEADERS as readonly string[], ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function camt053(n: NextDay): string {
  const amt = (m: bigint) => money(m < 0n ? -m : m);
  const entries = n.bankLines.map((l, i) => {
    const batch = /SETTLEMENT (B-[A-Z]{3}-\d{8})/.exec(l.description)?.[1] ?? "NOTPROVIDED";
    const ref = `NWDEMO${DEMO_TODAY.replace(/-/g, "")}${String(i + 1).padStart(3, "0")}`;
    return [
      "      <Ntry>", `        <NtryRef>${xml(l.bankLineId)}</NtryRef>`, `        <Amt Ccy="SGD">${amt(l.amountMinor)}</Amt>`, `        <CdtDbtInd>${l.amountMinor < 0n ? "DBIT" : "CRDT"}</CdtDbtInd>`,
      "        <Sts><Cd>BOOK</Cd></Sts>", `        <BookgDt><Dt>${l.valueDate}</Dt></BookgDt>`, `        <ValDt><Dt>${l.valueDate}</Dt></ValDt>`, `        <AcctSvcrRef>${ref}</AcctSvcrRef>`,
      "        <BkTxCd><Domn><Cd>PMNT</Cd><Fmly><Cd>RCDT</Cd><SubFmlyCd>ESCT</SubFmlyCd></Fmly></Domn></BkTxCd>",
      `        <NtryDtls><TxDtls><Refs><AcctSvcrRef>${ref}</AcctSvcrRef><EndToEndId>${batch}</EndToEndId></Refs><RmtInf><Ustrd>${xml(l.description)}</Ustrd></RmtInf></TxDtls></NtryDtls>`,
      `        <AddtlNtryInf>${xml(l.description)}</AddtlNtryInf>`, "      </Ntry>",
    ].join("\n");
  });
  const total = n.bankLines.reduce((t, l) => t + l.amountMinor, 0n);
  const opening = 42_118_350n; // fictional opening balance
  const bal = (code: string, m: bigint) => `      <Bal><Tp><CdOrPrtry><Cd>${code}</Cd></CdOrPrtry></Tp><Amt Ccy="SGD">${amt(m)}</Amt><CdtDbtInd>${m < 0n ? "DBIT" : "CRDT"}</CdtDbtInd><Dt><Dt>${DEMO_TODAY}</Dt></Dt></Bal>`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">',
    "  <BkToCstmrStmt>",
    `    <GrpHdr><MsgId>NWDEMO-C53-${DEMO_TODAY}</MsgId><CreDtTm>${DEMO_TODAY}T01:30:00Z</CreDtTm></GrpHdr>`,
    "    <Stmt>",
    `      <Id>NWDEMO-C53-${n.account}-${DEMO_TODAY}</Id>`, "      <ElctrncSeqNb>1</ElctrncSeqNb>", `      <CreDtTm>${DEMO_TODAY}T01:30:00Z</CreDtTm>`,
    `      <FrToDt><FrDtTm>${DEMO_TODAY}T00:00:00Z</FrDtTm><ToDtTm>${DEMO_TODAY}T23:59:59Z</ToDtTm></FrToDt>`,
    `      <Acct><Id><Othr><Id>${n.account}</Id></Othr></Id><Ccy>SGD</Ccy><Nm>Northwind Travel Pte. Ltd. (demo)</Nm><Svcr><FinInstnId><Nm>Fictional Harbour Bank (demo)</Nm></FinInstnId></Svcr></Acct>`,
    bal("OPBD", opening), bal("CLBD", opening + total),
    `      <TxsSummry><TtlNtries><NbOfNtries>${n.bankLines.length}</NbOfNtries></TtlNtries></TxsSummry>`,
    ...entries,
    "      <AddtlStmtInf>Demo · fictional data</AddtlStmtInf>",
    "    </Stmt>", "  </BkToCstmrStmt>", "</Document>", "",
  ].join("\n");
}

export async function bookingsXlsx(n: NextDay): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const at = new Date(`${DEMO_TODAY}T01:30:00.000Z`);
  wb.creator = "Northwind Travel (demo)"; wb.lastModifiedBy = "Northwind Travel (demo)"; wb.created = at; wb.modified = at;
  wb.subject = "Demo · fictional data"; wb.description = "Demo · fictional data";
  const ws = wb.addWorksheet("Bookings");
  ws.addRow(["Booking", "Book", "Traveller", "Trip", "Amount due", "Currency", "Booked (SGT)", "State"]);
  n.payments.forEach((p, i) => ws.addRow([p.orderId, n.entityId, `Traveller ${String(i + 1).padStart(3, "0")} (demo)`, ["Flight", "Hotel", "Rail pass", "Tour"][i % 4],
    Number(money(p.invoiceMinor)), "SGD", sgt(p.quoteCreatedAt), "open"]));
  ws.getColumn(5).numFmt = "#,##0.00";
  const buf = await wb.xlsx.writeBuffer();
  return normalizeZipTimes(new Uint8Array(buf as ArrayBuffer), DEMO_TODAY);
}

export async function demoFiles(): Promise<{ name: string; bytes: Uint8Array }[]> {
  const n = demoNextDay(demoWorld());
  const enc = new TextEncoder();
  return [
    { name: FILES.provider, bytes: enc.encode(providerCsv(n)) },
    { name: FILES.bank, bytes: enc.encode(camt053(n)) },
    { name: FILES.orders, bytes: await bookingsXlsx(n) },
  ];
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  void (async () => {
    mkdirSync(DEMO_FILES_DIR, { recursive: true });
    for (const f of await demoFiles()) { writeFileSync(path.join(DEMO_FILES_DIR, f.name), f.bytes); process.stdout.write(`demo-files/${f.name} (${f.bytes.length} bytes)\n`); }
  })();
}
