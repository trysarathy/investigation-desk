/**
 * Bank statements for the synthetic bank accounts in three formats: semicolon CSV (decimal comma, DD.MM.YYYY,
 * negatives in brackets), MT940 (one statement per value date, :20: :25: :28C: :60F: :61: :86: :62F:) and
 * camt.053.001.08 XML. In every format, opening balance + entries = closing balance. Accounts, references and the
 * bank itself are fictional; there are no IBANs or BICs.
 */
import { SYNTHETIC_LABEL } from "../fictional";
import type { BankAccountSpec, SyntheticWorld } from "../world";
import type { BankLine } from "../../merchant/types";
import { csv, decimal, dotted, utf8, xmlEscape, yymmdd } from "./format";
import { parseMonth } from "../time";

export interface StatementEntry { line: BankLine; bankRef: string; balanceAfterMinor: bigint }
export interface Statement { account: BankAccountSpec; fromDate: string; toDate: string; openingMinor: bigint; closingMinor: bigint; entries: StatementEntry[] }

/** The account's statement for the world's month: every line in value-date order with running balances. */
export function statementFor(world: SyntheticWorld, accountId: string): Statement {
  const account = world.bankAccounts.find((a) => a.accountId === accountId)!;
  const lines = world.bankLines.filter((l) => l.account === accountId).sort((a, b) => (a.valueDate < b.valueDate ? -1 : a.valueDate > b.valueDate ? 1 : a.bankLineId < b.bankLineId ? -1 : 1));
  let bal = account.openingBalanceMinor;
  const entries = lines.map((line, i) => {
    bal += line.amountMinor;
    return { line, bankRef: `FHB${account.currency}${world.month.slice(2).replace("-", "")}${String(i + 1).padStart(5, "0")}`, balanceAfterMinor: bal };
  });
  const fromDate = `${world.month}-01`;
  const last = entries.length ? entries[entries.length - 1].line.valueDate : fromDate;
  const monthEnd = `${world.month}-${String(parseMonth(world.month).days).padStart(2, "0")}`;
  return { account, fromDate, toDate: last > monthEnd ? last : monthEnd, openingMinor: account.openingBalanceMinor, closingMinor: bal, entries };
}

const euro = (m: bigint): string => {
  const s = decimal(m < 0n ? -m : m, 2, { group: ".", decimal: "," });
  return m < 0n ? `(${s})` : s;
};

/** Semicolon CSV, decimal comma, DD.MM.YYYY, negatives in brackets, running balance. */
export function bankStatementCsv(world: SyntheticWorld, accountId: string): Uint8Array {
  const st = statementFor(world, accountId);
  const rows = st.entries.map((e) => [dotted(e.line.valueDate), dotted(e.line.valueDate), e.bankRef, e.line.description, euro(e.line.amountMinor), e.line.currency, euro(e.balanceAfterMinor)]);
  return utf8(csv([["Booking Date", "Value Date", "Bank Reference", "Description", "Amount", "Currency", "Balance"], ...rows], ";"));
}

const swiftAmount = (m: bigint): string => decimal(m < 0n ? -m : m, 2, { decimal: "," });
const dc = (m: bigint): string => (m < 0n ? "D" : "C");

/** MT940: one statement message per value date with entries; each closing balance is the next opening balance. */
export function bankStatementMt940(world: SyntheticWorld, accountId: string): Uint8Array {
  const st = statementFor(world, accountId);
  const cur = st.account.currency;
  const days = [...new Set(st.entries.map((e) => e.line.valueDate))];
  let opening = st.openingMinor;
  let openingDate = st.fromDate;
  const out: string[] = [];
  days.forEach((day, i) => {
    const es = st.entries.filter((e) => e.line.valueDate === day);
    const closing = es[es.length - 1].balanceAfterMinor;
    out.push(`:20:FHB${yymmdd(day)}${cur}${String(i + 1).padStart(3, "0")}`);
    out.push(`:25:${accountId}`);
    out.push(`:28C:${String(i + 1).padStart(5, "0")}/001`);
    out.push(`:60F:${dc(opening)}${yymmdd(openingDate)}${cur}${swiftAmount(opening)}`);
    es.forEach((e, j) => {
      const settlement = /SETTLEMENT (B-[A-Z]{3}-\d{8})/.exec(e.line.description);
      const type = settlement ? "NTRF" : e.line.amountMinor < 0n && /FEE/.test(e.line.description) ? "NCHG" : /INTEREST/.test(e.line.description) ? "NINT" : "NTRF";
      const custRef = settlement ? settlement[1] : "NONREF";
      out.push(`:61:${yymmdd(day)}${day.slice(5, 7)}${day.slice(8, 10)}${dc(e.line.amountMinor)}${swiftAmount(e.line.amountMinor)}${type}${custRef}//${e.bankRef}`);
      const info = (i === 0 && j === 0 ? [SYNTHETIC_LABEL as string] : ([] as string[])).concat(wrap(e.line.description, 65));
      out.push(`:86:${info[0]}`, ...info.slice(1, 6));
    });
    out.push(`:62F:${dc(closing)}${yymmdd(day)}${cur}${swiftAmount(closing)}`);
    out.push("-");
    opening = closing;
    openingDate = day;
  });
  return utf8(out.join("\r\n") + "\r\n");
}

function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += width) out.push(text.slice(i, i + width));
  return out.length ? out : [""];
}

/** camt.053.001.08: one statement for the period with OPBD/CLBD balances and BOOK entries. */
export function bankStatementCamt053(world: SyntheticWorld, accountId: string): Uint8Array {
  const st = statementFor(world, accountId);
  const cur = st.account.currency;
  const amt = (m: bigint) => decimal(m < 0n ? -m : m, 2);
  const cd = (m: bigint) => (m < 0n ? "DBIT" : "CRDT");
  const msgId = `FHB-C53-${accountId}-${world.month.replace("-", "")}`;
  const bal = (code: string, m: bigint, date: string) =>
    `      <Bal>\n        <Tp><CdOrPrtry><Cd>${code}</Cd></CdOrPrtry></Tp>\n        <Amt Ccy="${cur}">${amt(m)}</Amt>\n        <CdtDbtInd>${cd(m)}</CdtDbtInd>\n        <Dt><Dt>${date}</Dt></Dt>\n      </Bal>`;
  const entries = st.entries.map((e) => {
    const settlement = /SETTLEMENT (B-[A-Z]{3}-\d{8})/.exec(e.line.description);
    const [domain, family, sub] = settlement ? ["PMNT", "RCDT", "ESCT"] : e.line.amountMinor < 0n && /FEE/.test(e.line.description) ? ["ACMT", "MDOP", "CHRG"] : /INTEREST/.test(e.line.description) ? ["ACMT", "MDOP", "INTR"] : ["PMNT", "ICDT", "ESCT"];
    return [
      "      <Ntry>",
      `        <NtryRef>${xmlEscape(e.line.bankLineId)}</NtryRef>`,
      `        <Amt Ccy="${cur}">${amt(e.line.amountMinor)}</Amt>`,
      `        <CdtDbtInd>${cd(e.line.amountMinor)}</CdtDbtInd>`,
      "        <Sts><Cd>BOOK</Cd></Sts>",
      `        <BookgDt><Dt>${e.line.valueDate}</Dt></BookgDt>`,
      `        <ValDt><Dt>${e.line.valueDate}</Dt></ValDt>`,
      `        <AcctSvcrRef>${e.bankRef}</AcctSvcrRef>`,
      `        <BkTxCd><Domn><Cd>${domain}</Cd><Fmly><Cd>${family}</Cd><SubFmlyCd>${sub}</SubFmlyCd></Fmly></Domn></BkTxCd>`,
      "        <NtryDtls><TxDtls>",
      `          <Refs><AcctSvcrRef>${e.bankRef}</AcctSvcrRef><EndToEndId>${settlement ? settlement[1] : "NOTPROVIDED"}</EndToEndId></Refs>`,
      `          <RmtInf><Ustrd>${xmlEscape(settlement ? settlement[1] : e.line.description.slice(0, 140))}</Ustrd></RmtInf>`,
      "        </TxDtls></NtryDtls>",
      `        <AddtlNtryInf>${xmlEscape(e.line.description)}</AddtlNtryInf>`,
      "      </Ntry>",
    ].join("\n");
  });
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">',
    "  <BkToCstmrStmt>",
    `    <GrpHdr><MsgId>${msgId}</MsgId><CreDtTm>${world.asOf.replace(".000Z", "Z")}</CreDtTm></GrpHdr>`,
    "    <Stmt>",
    `      <Id>${msgId}-1</Id>`,
    "      <ElctrncSeqNb>1</ElctrncSeqNb>",
    `      <CreDtTm>${world.asOf.replace(".000Z", "Z")}</CreDtTm>`,
    `      <FrToDt><FrDtTm>${st.fromDate}T00:00:00Z</FrDtTm><ToDtTm>${st.toDate}T23:59:59Z</ToDtTm></FrToDt>`,
    `      <Acct><Id><Othr><Id>${xmlEscape(accountId)}</Id></Othr></Id><Ccy>${cur}</Ccy><Nm>${xmlEscape(st.account.holderName)}</Nm><Svcr><FinInstnId><Nm>${xmlEscape(st.account.bankName)}</Nm></FinInstnId></Svcr></Acct>`,
    bal("OPBD", st.openingMinor, st.fromDate),
    bal("CLBD", st.closingMinor, st.toDate),
    `      <TxsSummry><TtlNtries><NbOfNtries>${st.entries.length}</NbOfNtries></TtlNtries></TxsSummry>`,
    ...entries,
    `      <AddtlStmtInf>${xmlEscape(SYNTHETIC_LABEL)}</AddtlStmtInf>`,
    "    </Stmt>",
    "  </BkToCstmrStmt>",
    "</Document>",
    "",
  ].join("\n");
  return utf8(xml);
}
