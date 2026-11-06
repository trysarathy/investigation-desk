import { createHash } from 'node:crypto';
import { parseCsv } from '../csv/parse';
import { amount, compare, instant, type FundingData, type ImportKind, type ColumnMapping } from './model';
const common = ['id', 'effective_at', 'known_at'];
export const columns: Record<ImportKind, string[]> = {
  customers: [...common, 'name', 'currency', 'credit_limit', 'terms', 'status'],
  advances: [...common, 'customer_id', 'supplier', 'invoice_ref', 'amount', 'currency', 'account', 'payout_at', 'due_at'],
  payouts: [...common, 'advance_id', 'account', 'amount', 'currency', 'reference'],
  receipts: [...common, 'customer_id', 'reference', 'account', 'amount', 'currency'],
  cash: [...common, 'snapshot_id', 'account', 'balance', 'currency', 'classification', 'amount'],
};
export function validateRow(kind: ImportKind, row: Record<string, string>) {
  for (const key of columns[kind]) {
    if (typeof row[key] !== 'string' || row[key].length > 1000 || /[\u0000-\u001f]/.test(row[key]) || row[key].trim() !== row[key]) throw Error(`${key}: use plain text without surrounding whitespace.`);
    if (!row[key] && !['terms', 'invoice_ref', 'reference'].includes(key)) throw Error(`${key} is required.`);
  }
  instant(row.effective_at); instant(row.known_at);
  if (instant(row.known_at) < instant(row.effective_at)) throw Error('The known time cannot be before the event happened.');
  if (!['SGD', 'USD'].includes(row.currency)) throw Error('This pilot accepts SGD and USD only.');
  for (const key of ['amount', 'balance', 'credit_limit']) if (key in row) amount(row[key]);
  if (['advances', 'payouts', 'receipts'].includes(kind) && compare(row.amount, '0') <= 0) throw Error('The amount must be greater than zero.');
  if (kind === 'customers' && !['active', 'suspended'].includes(row.status)) throw Error('Customer status must be active or suspended.');
  if (kind === 'advances') {
    instant(row.payout_at); instant(row.due_at);
    if (instant(row.due_at) < instant(row.payout_at)) throw Error('Repayment cannot be due before the planned payout.');
  }
  if (kind === 'cash' && !['free', 'safeguarded customer money', 'pending payouts', 'buffer'].includes(row.classification)) throw Error('Choose free, safeguarded customer money, pending payouts, or buffer.');
}
export function importCsv(data: FundingData, kind: ImportKind, text: string, mapping: ColumnMapping | undefined, filename: string, importedAt: string): FundingData {
  if (!Object.hasOwn(columns, kind)) throw Error('Choose a supported import type.');
  instant(importedAt);
  if (Buffer.byteLength(text) > 2_000_000) throw Error('Split this file into files smaller than 2 MB.');
  if (!filename || filename.length > 200) throw Error('Give this input a short file name.');
  const csv = parseCsv(text);
  if (csv.fileErrors.length || csv.recordErrors.length) throw Error([...csv.fileErrors, ...csv.recordErrors.map(e => `Row ${e.line}: ${e.message}`)].join(' '));
  if (new Set(csv.header).size !== csv.header.length) throw Error('The file has duplicate column names.');
  const map = mapping ?? data.mappings[kind] ?? Object.fromEntries(columns[kind].map(k => [k, k]));
  if (Object.keys(map).length !== columns[kind].length || columns[kind].some(k => !Object.hasOwn(map, k) || !csv.header.includes(map[k])) || new Set(Object.values(map)).size !== columns[kind].length) throw Error('Map each required field to a different column in this file.');
  const next = structuredClone(data), records = next[kind] as unknown as Record<string, string>[];
  const sha256 = createHash('sha256').update(text).digest('hex');
  const duplicates: string[] = [];
  let accepted = 0;
  for (const record of csv.records) {
    try {
      if (record.cells.length !== csv.header.length) throw Error('The number of values does not match the header.');
      const row = Object.fromEntries(columns[kind].map(k => [k, record.cells[csv.header.indexOf(map[k])]]));
      validateRow(kind, row);
      if (kind === 'advances' && !next.customers.some(c => c.id === row.customer_id && c.currency === row.currency)) throw Error('Import this customer and its currency before its advances.');
      if (kind === 'payouts' && !next.advances.some(a => a.id === row.advance_id && a.currency === row.currency && a.account === row.account)) throw Error('The payout must name an existing advance with the same currency and account.');
      if (kind === 'receipts' && !next.customers.some(c => c.id === row.customer_id)) throw Error('Import the customer before its receipts.');
      const previous = records.find(r => r.id === row.id);
      if (previous) {
        if (columns[kind].some(k => previous[k] !== row[k])) throw Error(`Record ${row.id} already exists with different values; correct the source rather than overwriting history.`);
        duplicates.push(row.id); continue;
      }
      records.push({ ...row, source: `${sha256}:${record.line}`, ...(kind === 'advances' ? { state: 'proposed' } : {}) }); accepted++;
    } catch (e) { throw Error(`Row ${record.line}: ${e instanceof Error ? e.message : 'Cannot read this row.'}`); }
  }
  next.mappings[kind] = { ...map };
  next.imports.push({ id: `${sha256}:${next.imports.length}`, kind, filename, sha256, text, mapping: { ...map }, imported_at: importedAt, accepted, duplicates });
  return next;
}
