// All values in this module are fictional. This is a deterministic, browser-only
// mentor simulation; it NEVER creates a real credit approval or moves money.
export type Role = "operator" | "approver" | "viewer";
export type Stage = "proposed" | "prepared" | "approved" | "supplier_paid" | "partly_repaid" | "repaid" | "declined" | "written_off";
export type Customer = { id: string; name: string; creditLimit: number; terms: string; active: boolean };
export type Advance = {
  id: string; customerId: string; supplier: string; invoice: string;
  amount: number; currency: "SGD"; due: string; payoutDate: string; stage: Stage;
  invoicePresent: boolean; termsOnFile: boolean; paid: number; repaid: number;
  writtenOff: number; preparedBy?: string; decidedBy?: string; reason?: string;
};
export type Event = { id: number; at: string; advanceId: string; actor: string; label: string; detail: string };
export type Demo = {
  asOf: string; customers: Customer[]; advances: Advance[]; events: Event[];
  cash: { balance: number; safeguarded: number; pending: number; buffer: number };
  unmatched: { id: string; customer: string; amount: number; reference: string }[];
};
export type Check = { key: string; title: string; status: "pass" | "fail" | "needs_review"; reason: string };
const customerSeeds: Customer[] = [
  { id: "C-001", name: "Redwood Wholesale", creditLimit: 220000, terms: "7 days", active: true },
  { id: "C-002", name: "Seabright Trading", creditLimit: 160000, terms: "7 days", active: true },
  { id: "C-003", name: "Northstar Components", creditLimit: 125000, terms: "14 days", active: true },
];
const advanceSeeds: Advance[] = [
  { id: "ADV-001", customerId: "C-001", supplier: "Harbor Machinery", invoice: "INV-RW-1042", amount: 100000, currency: "SGD", due: "2026-11-17", payoutDate: "2026-11-10", stage: "proposed", invoicePresent: true, termsOnFile: true, paid: 0, repaid: 0, writtenOff: 0 },
  { id: "ADV-002", customerId: "C-002", supplier: "Eastport Supplies", invoice: "INV-ST-3281", amount: 85000, currency: "SGD", due: "2026-11-05", payoutDate: "2026-11-01", stage: "partly_repaid", invoicePresent: true, termsOnFile: true, paid: 85000, repaid: 25000, writtenOff: 0, preparedBy: "Maya · Operator", decidedBy: "Daniel · Treasury", reason: "Approved after finance review" },
  { id: "ADV-003", customerId: "C-003", supplier: "Pacific Metals", invoice: "INV-NC-5011", amount: 45000, currency: "SGD", due: "2026-11-15", payoutDate: "2026-11-03", stage: "repaid", invoicePresent: true, termsOnFile: true, paid: 45000, repaid: 45000, writtenOff: 0, preparedBy: "Maya · Operator", decidedBy: "Daniel · Treasury", reason: "Approved after finance review" },
];
const seedEvents: Event[] = [
  { id: 1, at: "2026-11-01", advanceId: "ADV-002", actor: "Daniel · Treasury", label: "Supplier paid", detail: "SGD 85,000, recorded from synthetic payout export" },
  { id: 2, at: "2026-11-03", advanceId: "ADV-003", actor: "Daniel · Treasury", label: "Supplier paid", detail: "SGD 45,000, recorded from synthetic payout export" },
  { id: 3, at: "2026-11-07", advanceId: "ADV-002", actor: "Maya · Operator", label: "Partial receipt", detail: "SGD 25,000 from Seabright Trading" },
  { id: 4, at: "2026-11-08", advanceId: "ADV-003", actor: "Maya · Operator", label: "Fully repaid", detail: "SGD 45,000 received and allocated by reference" },
];
export const actors: Record<Role, string> = {
  operator: "Maya · Operator", approver: "Daniel · Treasury", viewer: "Alex · Viewer",
};
export function initialDemo(): Demo {
  return {
    asOf: "2026-11-09",
    customers: customerSeeds.map((c) => ({ ...c })),
    advances: advanceSeeds.map((a) => ({ ...a })),
    cash: { balance: 490000, safeguarded: 130000, pending: 45000, buffer: 65000 },
    unmatched: [{ id: "RCPT-008", customer: "Unknown remitter", amount: 12500, reference: "REF-UNIDENTIFIED" }],
    events: seedEvents.map((e) => ({ ...e })),
  };
}
export const money = (n: number) => "SGD " + n.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const freeCash = (s: Demo) => s.cash.balance - s.cash.safeguarded - s.cash.pending - s.cash.buffer;
export const outstanding = (a: Advance) => Math.max(0, a.paid - a.repaid - a.writtenOff);
export const committed = (a: Advance) =>
  ["approved", "supplier_paid", "partly_repaid", "repaid", "written_off"].includes(a.stage)
    ? Math.max(0, a.amount - a.paid) : 0;
export function review(s: Demo, id: string): Check[] {
  const a = s.advances.find((row) => row.id === id);
  if (!a) throw Error("Advance not found.");
  const c = s.customers.find((row) => row.id === a.customerId);
  if (!c) throw Error("Customer record missing.");
  const duplicate = s.advances.some((row) => row.id !== id && row.customerId === a.customerId && row.invoice === a.invoice && row.stage !== "declined");
  const exposure = s.advances.filter((row) => row.id !== id && row.customerId === a.customerId)
    .reduce((sum, row) => sum + outstanding(row) + committed(row), 0);
  const overdue = s.advances.find((row) =>
    row.id !== id && row.customerId === a.customerId && row.due < s.asOf && outstanding(row) > 0);
  const cash = freeCash(s);
  return [
    { key: "invoice", title: "Invoice on file and not funded twice", status: !a.invoicePresent ? "needs_review" : duplicate ? "fail" : "pass", reason: !a.invoicePresent ? "Invoice evidence has not been supplied." : duplicate ? "Another open advance uses the same customer and invoice." : "Invoice reference is present and unique." },
    { key: "limit", title: "Customer remains within agreed limit", status: !c.active || exposure + a.amount > c.creditLimit ? "fail" : "pass", reason: !c.active ? "Customer is not active." : `Including this advance: ${money(exposure + a.amount)} / ${money(c.creditLimit)} limit.` },
    { key: "overdue", title: "No earlier overdue advances", status: overdue ? "fail" : "pass", reason: overdue ? `${overdue.id} remains unpaid after its due date.` : "No earlier overdue funding for this customer." },
    { key: "terms", title: "Agreed funding terms recorded", status: !a.termsOnFile || !c.terms ? "needs_review" : "pass", reason: a.termsOnFile ? `Agreed repayment terms: ${c.terms}.` : "Terms need confirmation." },
    { key: "cash", title: "Genuinely free cash covers this advance", status: cash >= a.amount ? "pass" : "fail", reason: `Free cash ${money(cash)} after safeguarded money, pending payouts and buffer. Confirm classifications with counsel.` },
  ];
}
export type Exception = { id: string; advanceId?: string; title: string; detail: string; severity: "high" | "medium" };
export function exceptions(s: Demo): Exception[] {
  const found: Exception[] = [];
  for (const a of s.advances) {
    if (outstanding(a) > 0 && a.due < s.asOf)
      found.push({ id: a.id + "-late", advanceId: a.id, title: "Overdue customer repayment", detail: `${a.id} · ${money(outstanding(a))} due ${a.due}`, severity: "high" });
    if (outstanding(a) > 0 && a.repaid > 0)
      found.push({ id: a.id + "-partial", advanceId: a.id, title: "Partly repaid", detail: `${a.id} · ${money(outstanding(a))} still owed`, severity: "medium" });
  }
  for (const r of s.unmatched)
    found.push({ id: r.id, title: "Unmatched incoming receipt", detail: `${money(r.amount)} · ${r.reference}; no automatic allocation`, severity: "medium" });
  return found;
}
function log(s: Demo, id: string, actor: string, label: string, detail: string): Demo {
  return { ...s, events: [...s.events, { id: s.events.length + 1, at: s.asOf, advanceId: id, actor, label, detail }] };
}
function update(s: Demo, id: string, change: Partial<Advance>): Demo {
  return { ...s, advances: s.advances.map((a) => a.id === id ? { ...a, ...change } : a) };
}
export function prepare(s: Demo, id: string, role: Role): Demo {
  const a = s.advances.find((row) => row.id === id);
  if (role !== "operator" || !a || a.stage !== "proposed") throw Error("Only an operator can prepare a proposed advance.");
  return log(update(s, id, { stage: "prepared", preparedBy: actors[role] }), id, actors[role], "Prepared for treasury", "Evidence checks attached; this is not an approval.");
}
export function decide(s: Demo, id: string, role: Role, outcome: "approved" | "declined", reason: string): Demo {
  const a = s.advances.find((row) => row.id === id);
  if (role !== "approver" || !a || a.stage !== "prepared" || a.preparedBy === actors[role])
    throw Error("A different treasury approver must decide a prepared advance.");
  if (!reason.trim()) throw Error("A decision reason is required.");
  if (outcome === "approved" && review(s, id).some((c) => c.status !== "pass"))
    throw Error("Resolve failed or uncertain checks before approval.");
  return log(update(s, id, { stage: outcome, decidedBy: actors[role], reason: reason.trim() }), id, actors[role], outcome === "approved" ? "Approved by treasury" : "Declined by treasury", reason.trim());
}
export function payout(s: Demo, id: string, role: Role): Demo {
  const a = s.advances.find((row) => row.id === id);
  if (role !== "operator" || !a || a.stage !== "approved" || s.asOf < a.payoutDate)
    throw Error("A recorded treasury approval and the payout date are required.");
  return log(update(s, id, { stage: "supplier_paid", paid: a.amount }), id, actors[role], "Supplier payout recorded", `${money(a.amount)} · imported payout evidence, not a money transfer.`);
}
export function repay(s: Demo, id: string, role: Role, amount: number): Demo {
  const a = s.advances.find((row) => row.id === id);
  if (role !== "operator" || !a || a.paid <= 0 || !Number.isSafeInteger(amount) || amount <= 0 || amount > outstanding(a))
    throw Error("Enter a positive whole-SGD receipt no greater than this advance's outstanding amount.");
  const remaining = outstanding(a) - amount;
  const next = update(s, id, { repaid: a.repaid + amount, stage: remaining ? "partly_repaid" : "repaid" });
  return log(next, id, actors[role], remaining ? "Partial receipt matched" : "Fully repaid", `${money(amount)} assigned to ${a.invoice} by explicit reference; ${money(remaining)} remains.`);
}
export function setDate(s: Demo, date: string): Demo {
  if (!/^2026-11-(0[1-9]|[12][0-9]|30)$/.test(date)) throw Error("Choose a date in November 2026.");
  return { ...s, asOf: date };
}
export function dailyDigest(s: Demo) {
  const rows = exceptions(s);
  return rows.length ? `Clearline funding exceptions — ${s.asOf}\n` +
    rows.map((e) => `• ${e.title}: ${e.detail}`).join("\n") + "\n" :
    `All clear — no exceptions on ${s.asOf}.\n`;
}
export function ledgerCsv(s: Demo) {
  const rows = [["advance_id", "customer", "supplier", "invoice_ref", "currency", "approved_amount", "supplier_paid", "customer_repaid", "still_owed", "due_date", "status"]];
  for (const a of s.advances) {
    const c = s.customers.find((row) => row.id === a.customerId)!;
    rows.push([a.id, c.name, a.supplier, a.invoice, a.currency, String(a.amount), String(a.paid), String(a.repaid), String(outstanding(a)), a.due, a.stage]);
  }
  // Guard against spreadsheet-formula injection on untrusted future inputs.
  const cell = (s: string) => {
    const safe = /^[=+@\-\t\r]/.test(s) ? "'" + s : s;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
export function journalCsv(s: Demo) {
  const rows: string[][] = [["date", "reference", "account", "debit", "credit", "currency"]];
  for (const a of s.advances) {
    if (a.paid > 0) {
      rows.push([a.payoutDate, a.invoice, "Advance receivable", String(a.paid), "0", "SGD"]);
      rows.push([a.payoutDate, a.invoice, "Bank - illustrative", "0", String(a.paid), "SGD"]);
    }
    if (a.repaid > 0) {
      rows.push([s.asOf, a.invoice, "Bank - illustrative", String(a.repaid), "0", "SGD"]);
      rows.push([s.asOf, a.invoice, "Advance receivable", "0", String(a.repaid), "SGD"]);
    }
  }
  return rows.map((r) => r.join(",")).join("\r\n") + "\r\n";
}
