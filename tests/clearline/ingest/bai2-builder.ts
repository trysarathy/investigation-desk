/**
 * Test helper: writes a BAI2 file whose trailers (control totals and record counts) are computed from its content, so
 * tests and fuzzing start from a valid file and then break exactly one thing. Fictional values only.
 */
export interface Bai2Txn { code: string; amount: bigint; funds?: string[]; bankRef?: string; customerRef?: string; text?: string; continuation?: string[] }
export interface Bai2Account { account: string; currency?: string; status?: [string, bigint][]; summaries?: [string, bigint, number?][]; txns: Bai2Txn[] }
export interface Bai2Group { asOf: string; currency?: string; status?: string; accounts: Bai2Account[] }
export interface Bai2File { fileId?: string; created?: string; version?: string; groups: Bai2Group[]; eol?: string }

export function buildBai2(f: Bai2File): string {
  const out: string[] = [`01,FICTSENDER,FICTRECEIVER,${f.created ?? "261120"},0200,${f.fileId ?? "FICT-FILE-1"},80,1,${f.version ?? "2"}/`];
  let fileTotal = 0n;
  for (const g of f.groups) {
    const gStart = out.length;
    out.push(`02,FICTRECEIVER,FICTBANK,${g.status ?? "1"},${g.asOf},2359,${g.currency ?? ""},2/`);
    let groupTotal = 0n;
    for (const a of g.accounts) {
      const aStart = out.length;
      let total = 0n;
      const parts: string[] = [];
      for (const [code, amt] of a.status ?? []) { parts.push(code, amt.toString(), "", ""); total += amt; }
      for (const [code, amt, items] of a.summaries ?? []) { parts.push(code, amt.toString(), items === undefined ? "" : String(items), ""); total += amt; }
      out.push(`03,${a.account},${a.currency ?? ""},${parts.join(",")}/`);
      for (const t of a.txns) {
        total += t.amount;
        const funds = t.funds ?? ["0"];
        out.push(`16,${t.code},${t.amount},${funds.join(",")},${t.bankRef ?? ""},${t.customerRef ?? ""},${t.text ?? ""}`);
        for (const c of t.continuation ?? []) out.push(`88,${c}`);
      }
      out.push(`49,${total},${out.length - aStart + 1}/`);
      groupTotal += total;
    }
    out.push(`98,${groupTotal},${g.accounts.length},${out.length - gStart + 1}/`);
    fileTotal += groupTotal;
  }
  out.push(`99,${fileTotal},${f.groups.length},${out.length + 1}/`);
  return out.join(f.eol ?? "\r\n") + (f.eol ?? "\r\n");
}

/** One SGD account, a normal day: two credits, one debit, opening and closing ledger, credit and debit summaries. */
export const NORMAL: Bai2File = {
  fileId: "FICT-BAI-NORMAL",
  groups: [{ asOf: "261119", currency: "SGD", accounts: [{
    account: "FICT00004321", currency: "SGD",
    status: [["010", 100000n], ["015", 245000n]],
    summaries: [["100", 175000n, 2], ["400", 30000n, 1]],
    txns: [
      { code: "195", amount: 125000n, bankRef: "FICTBANK0001", customerRef: "INV-1001", text: "INCOMING TRANSFER FICTIONAL PAYER PTE" },
      { code: "165", amount: 50000n, funds: ["V", "261120", ""], bankRef: "FICTBANK0002", customerRef: "INV-1002", text: "PAYOUT BATCH FICT-B-7", continuation: ["SETTLEMENT FOR 2026-11-18, FICTIONAL PROVIDER"] },
      { code: "495", amount: 30000n, bankRef: "FICTBANK0003", customerRef: "", text: "OUTGOING TRANSFER FICTIONAL SUPPLIER" },
    ],
  }] }],
};

/** Returns and reversals: a credit, the same credit returned (555), a debit reversed back as a credit (no flag). */
export const RETURNS: Bai2File = {
  fileId: "FICT-BAI-RETURNS",
  groups: [{ asOf: "261120", currency: "USD", accounts: [{
    account: "FICT-ACCT-0002", currency: "USD",
    status: [["010", 50000n], ["015", 50000n]],
    txns: [
      { code: "301", amount: 20000n, bankRef: "FICTBANK0101", customerRef: "INV-2001", text: "DEPOSIT" },
      { code: "555", amount: 20000n, bankRef: "FICTBANK0102", customerRef: "INV-2001", text: "DEPOSITED ITEM RETURNED" },
      { code: "699", amount: 700n, bankRef: "FICTBANK0103", text: "FEE" },
      { code: "399", amount: 700n, bankRef: "FICTBANK0104", text: "FEE REVERSED" },
      { code: "910", amount: 1n, bankRef: "FICTBANK0105", text: "BANK SPECIFIC CODE, DIRECTION UNKNOWN" },
    ],
  }] }],
};

/** Two accounts in one group: refused (one upload, one bank account). */
export const TWO_ACCOUNTS: Bai2File = {
  fileId: "FICT-BAI-TWO",
  groups: [{ asOf: "261120", currency: "SGD", accounts: [
    { account: "FICT00004321", status: [["010", 0n], ["015", 1000n]], txns: [{ code: "195", amount: 1000n, bankRef: "FICTBANK0201" }] },
    { account: "FICT00009999", status: [["010", 0n], ["015", 500n]], txns: [{ code: "195", amount: 500n, bankRef: "FICTBANK0202" }] },
  ] }],
};
