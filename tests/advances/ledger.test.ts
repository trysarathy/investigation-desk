import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { replay, exportCsv, openColumns } from '../../src/lib/advances/ledger';
const payouts = readFileSync('fixtures/advances/payouts.csv', 'utf8');
const bank = readFileSync('fixtures/advances/bank.csv', 'utf8');
const asOf = '2026-11-21T00:00:00Z';
const run = (b = bank, p = payouts, at = asOf) => replay(p, b, at);
describe('synthetic still-owed ledger', () => {
  it('separates importer receipts from provider repayment and closes only B', () => {
    const r = run(); expect(r.rows.map(a => [a.advance_id, a.still_owed])).toEqual([['SYN-A', '35532.5']]);
    expect(r.exceptions.map(a => a.exception)).toEqual(['importer paid but provider not fully repaid', 'overdue', 'partial repayment']);
  });
  it('deduplicates identical bank and payout rows', () => {
    expect(run(bank + bank.split('\n')[2] + '\n', payouts + payouts.split('\n')[1] + '\n')).toEqual(run());
  });
  it('rejects conflicting duplicate events even if future known', () => {
    expect(() => run(bank + bank.split('\n')[2].replace('100000.00', '200000.00') + '\n')).toThrow('conflicting duplicate');
  });
  it.each(['SYN-WRONG', 'SYN-IMPORTER'])('does not match provider repayment into %s', account => {
    const r = run(bank.replace('SYN-E2,SYN-A,SYN-PROVIDER-SGD', `SYN-E2,SYN-A,${account}`));
    expect(r.rows[0].still_owed).toBe('135532.5'); expect(r.exceptions[0].exception).toBe('provider account mismatch');
  });
  it('does not convert wrong-currency repayments', () => {
    const r = run(bank.replace('provider_repayment,SGD,100000.00', 'provider_repayment,USD,100000.00'));
    expect(r.rows[0].still_owed).toBe('135532.5'); expect(r.exceptions[0].exception).toBe('wrong currency');
  });
  it('holds excess separately, without negative receivables', () => {
    const r = run(bank.replace('100000.00', '200000.00'));
    expect(r.rows).toEqual([]); expect(r.exceptions[0].amount).toBe('64467.5');
  });
  it('does not attribute by amount when reference is unknown', () => {
    const r = run(bank.replace('SYN-E3,SYN-B', 'SYN-E3,SYN-UNKNOWN'));
    expect(r.rows).toHaveLength(2); expect(r.exceptions[0].exception).toBe('unknown advance');
  });
  it('ignores future-known and future-occurring evidence', () => {
    expect(run(bank, payouts, '2026-11-18T03:00:00Z').rows[0].still_owed).toBe('135532.5');
    const late = bank.replace('100000.00,2026-11-19T03:00:00Z,2026-11-19T03:00:00Z', '100000.00,2026-11-19T03:00:00Z,2026-11-22T03:00:00Z');
    expect(run(late).rows[0].still_owed).toBe('135532.5');
  });
  it.each(['0', '-1', 'NaN', '1e3', '0.001'])('rejects invalid amounts %s', amount => expect(() => run(bank.replace('100000.00', amount))).toThrow());
  it('rejects bad CSV instead of keeping a partial import', () => expect(() => run(bank + 'broken,row\n')).toThrow());
  it('rejects invalid dates and conflicting advance ids', () => {
    expect(() => run(bank.replace('2026-11-19', '2026-02-30'))).toThrow();
    expect(() => run(bank, payouts + payouts.split('\n')[1].replace('135382.50', '1') + '\n')).toThrow('conflicting duplicate');
  });
  it('does not call a balance overdue at the exact due timestamp', () => {
    expect(run(bank, payouts, '2026-11-20T09:00:00Z').exceptions.some(e => e.exception === 'overdue')).toBe(false);
  });
  it('refuses a receipt before the advance was drawn', () => {
    const early = bank.replaceAll('2026-11-19T03:00:00Z', '2026-11-17T03:00:00Z');
    expect(run(early).rows[0].still_owed).toBe('135532.5');
    expect(run(early).exceptions[0].exception).toBe('receipt precedes advance');
  });
  it('keeps source rows and escapes spreadsheet formulas', () => {
    const r = run(bank, payouts.replace('Northwind Synthetic', '=1+1'));
    expect(r.rows[0].evidence).toContain('bank:3/SYN-E2'); expect(exportCsv(r.rows, openColumns)).toContain("'=1+1");
  });
});
