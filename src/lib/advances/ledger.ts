import { parseCsv } from '../csv/parse.js';
import { csvCell } from '../csv/cell.js';
import { add, sub } from '../payments/money.js';

const payoutHeader = 'advance_id,importer,provider_account,currency,principal,fee,due_at,occurred_at,known_at';
const bankHeader = 'event_id,advance_id,account_id,kind,currency,amount,occurred_at,known_at';
type Row = Record<string, string>;
const cents = (s: string) => {
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw Error(`Invalid nonnegative amount: ${s}`);
  const [whole, fraction = ''] = s.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
};
function time(s: string): number {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString() !== s.replace('Z', '.000Z')) throw Error(`Invalid UTC timestamp: ${s}`);
  return Date.parse(s);
}
function read(text: string, header: string, source: string): Row[] {
  const parsed = parseCsv(text);
  if (parsed.header.join(',') !== header || parsed.fileErrors.length || parsed.recordErrors.length) throw Error(`${source}: invalid CSV or headers`);
  const unique = new Map<string, Row>();
  for (const record of parsed.records) {
    if (record.cells.length !== parsed.header.length || record.cells.some(x => !x || x.trim() !== x)) throw Error(`${source}:${record.line}: missing/extra/whitespace field`);
    const row = Object.fromEntries(parsed.header.map((key, i) => [key, record.cells[i]]));
    for (const key of ['occurred_at', 'known_at', ...(source === 'payouts' ? ['due_at'] : [])]) time(row[key]);
    if (time(row.known_at) < time(row.occurred_at)) throw Error(`${source}:${record.line}: known before occurrence`);
    if (!['SGD', 'USD'].includes(row.currency)) throw Error(`${source}:${record.line}: unsupported currency`);
    for (const key of source === 'payouts' ? ['principal', 'fee'] : ['amount']) cents(row[key]);
    if (cents(row[source === 'bank' ? 'amount' : 'principal']) === 0n) throw Error(`${source}:${record.line}: amount must be positive`);
    if (source === 'bank' && !['provider_repayment', 'importer_receipt'].includes(row.kind)) throw Error(`${source}:${record.line}: invalid kind`);
    const id = record.cells[0];
    const prior = unique.get(id);
    if (prior && parsed.header.some(key => prior[key] !== row[key])) throw Error(`${source}:${record.line}: conflicting duplicate ${id}`);
    if (!prior) unique.set(id, { ...row, source: `${source}:${record.line}` });
  }
  return [...unique.values()];
}
export function replay(payouts: string, bank: string, asOf: string) {
  const at = time(asOf);
  // Validate the entire import before considering the as-of slice.
  const advances = read(payouts, payoutHeader, 'payouts');
  const events = read(bank, bankHeader, 'bank');
  const visible = (r: Row) => time(r.known_at) <= at && time(r.occurred_at) <= at;
  const open = new Map<string, Row>(advances.filter(visible).map(a => [a.advance_id, { ...a, repaid: '0', owed: add(a.principal, a.fee), evidence: a.source, importerReceipt: '' }]));
  const exceptions: Row[] = [];
  const flag = (advance: string, code: string, source: string, amount = '', currency = '') => exceptions.push({ simulation: 'SYNTHETIC ONLY', as_of: asOf, advance_id: advance, exception: code, amount, currency, evidence: source });
  for (const event of events.filter(visible).sort((a, b) => time(a.occurred_at) - time(b.occurred_at) || a.event_id.localeCompare(b.event_id))) {
    const a = open.get(event.advance_id);
    const source = `${event.source}/${event.event_id}`;
    if (!a) { flag(event.advance_id, 'unknown advance', source, event.amount, event.currency); continue; }
    if (time(event.occurred_at) < time(a.occurred_at)) { flag(a.advance_id, 'receipt precedes advance', source); continue; }
    if (event.kind === 'importer_receipt') { a.importerReceipt = 'yes'; a.evidence += `;${source}`; continue; }
    if (event.account_id !== a.provider_account) { flag(a.advance_id, 'provider account mismatch', source, event.amount, event.currency); continue; }
    if (event.currency !== a.currency) { flag(a.advance_id, 'wrong currency', source, event.amount, event.currency); continue; }
    const applied = cents(event.amount) > cents(a.owed) ? a.owed : event.amount;
    const excess = sub(event.amount, applied);
    a.repaid = add(a.repaid, applied); a.owed = sub(a.owed, applied); a.evidence += `;${source}`;
    if (cents(excess) > 0n) flag(a.advance_id, 'unapplied overpayment', source, excess, a.currency);
  }
  const rows: Row[] = [];
  for (const a of open.values()) {
    if (!cents(a.owed)) continue;
    rows.push({ simulation: 'SYNTHETIC ONLY', as_of: asOf, advance_id: a.advance_id, importer: a.importer, provider_account: a.provider_account, currency: a.currency, principal: a.principal, fee: a.fee, repaid: a.repaid, still_owed: a.owed, due_at: a.due_at, evidence: a.evidence });
    if (a.importerReceipt) flag(a.advance_id, 'importer paid but provider not fully repaid', a.evidence, a.owed, a.currency);
    if (time(a.due_at) < at) flag(a.advance_id, 'overdue', a.evidence, a.owed, a.currency);
    if (cents(a.repaid)) flag(a.advance_id, 'partial repayment', a.evidence, a.owed, a.currency);
  }
  return { rows, exceptions };
}
export function exportCsv(rows: Row[], headers: string[]) {
  return [headers, ...rows.map(row => headers.map(h => row[h]))].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
export const openColumns = ['simulation', 'as_of', 'advance_id', 'importer', 'provider_account', 'currency', 'principal', 'fee', 'repaid', 'still_owed', 'due_at', 'evidence'];
export const exceptionColumns = ['simulation', 'as_of', 'advance_id', 'exception', 'amount', 'currency', 'evidence'];
