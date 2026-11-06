import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { columns, importCsv } from '../../src/lib/funding/imports';
import { amount, emptyFunding, instant, visible, type ImportKind } from '../../src/lib/funding/model';
import { FundingStore, validateFundingData } from '../../src/lib/funding/store';
const now = '2026-11-19T09:00:00Z';
const file = (kind: ImportKind) => readFileSync(`fixtures/funding/${kind}.csv`, 'utf8');
const load = () => (Object.keys(columns) as ImportKind[]).reduce((d, kind) => importCsv(d, kind, file(kind), undefined, `${kind}.csv`, now), emptyFunding());
describe('funding input boundary', () => {
  it('loads all five synthetic files with immutable sources', () => { const d = load(); expect(d.imports).toHaveLength(5); expect(d.cash).toHaveLength(4); expect(d.advances[0].state).toBe('proposed'); expect(d.receipts[0].source).toMatch(/^[a-f0-9]{64}:2$/); });
  it('remembers a provider column mapping across store restarts', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'funding-')), 'data.json'); const store = new FundingStore(path);
    const text = file('customers').replace('credit_limit', 'Approved limit');
    const map = Object.fromEntries(columns.customers.map(k => [k, k === 'credit_limit' ? 'Approved limit' : k]));
    await store.update(d => [importCsv(d, 'customers', text, map, 'customer.csv', now), undefined]);
    const again = new FundingStore(path); await again.update(d => [importCsv(d, 'customers', text, undefined, 'customer.csv', now), undefined]);
    const d = await again.load(); expect(d.customers).toHaveLength(1); expect(d.revision).toBe(2); expect(d.imports[1].duplicates).toEqual(['customer-1']);
  });
  it.each(['1e3', '-1', '1.001', '01', 'Infinity'])('rejects ambiguous money %s', value => expect(() => amount(value)).toThrow());
  it('retains exact large amounts', () => expect(amount('999999999999999.99')).toBe('999999999999999.99'));
  it('rejects impossible dates', () => expect(() => instant('2026-02-30T00:00:00Z')).toThrow());
  it('does not reveal future-known evidence', () => { const r = load().receipts[0]; expect(visible(r, r.effective_at)).toBe(false); expect(visible(r, now)).toBe(true); });
  it('rejects a conflicting id instead of overwriting a limit', () => expect(() => importCsv(load(), 'customers', file('customers').replace('200000', '300000'), undefined, 'x', now)).toThrow(/different values/));
  it('rejects missing customer and mismatched payout accounts', () => {
    expect(() => importCsv(emptyFunding(), 'advances', file('advances'), undefined, 'x', now)).toThrow(/customer/);
    expect(() => importCsv(load(), 'payouts', file('payouts').replace('provider-sgd', 'other'), undefined, 'x', now)).toThrow(/account/);
  });
  it('rejects duplicate headers and many-to-one mappings', () => {
    expect(() => importCsv(emptyFunding(), 'customers', file('customers').replace('name', 'id'), undefined, 'x', now)).toThrow(/duplicate column/);
    expect(() => importCsv(emptyFunding(), 'customers', file('customers'), Object.fromEntries(columns.customers.map(k => [k, 'id'])), 'x', now)).toThrow(/different column/);
  });
  it('rejects the entire file and preserves prior state on a bad row', () => {
    const d = emptyFunding(); const text = file('customers') + file('customers').split('\n')[1].replace('customer-1', 'customer-2').replace('SGD', 'JPY') + '\n';
    expect(() => importCsv(d, 'customers', text, undefined, 'x', now)).toThrow(/Row 3/); expect(d.customers).toHaveLength(0);
  });
  it.each(['state', 'source', 'amount', 'mapping', 'identity', 'customer'])('rejects changed %s in otherwise valid stored data', field => {
    const d = load();
    if (field === 'state') d.advances[0].state = 'repaid';
    if (field === 'source') d.advances[0].source = '';
    if (field === 'amount') d.advances[0].amount = '1';
    if (field === 'mapping') d.mappings.customers = {};
    if (field === 'customer') d.advances[0].customer_id = 'missing';
    if (field === 'identity') d.users.push({ id: 'x', name: 'x', role: 'approver' });
    expect(() => validateFundingData(d)).toThrow();
  });
  it('rejects invalid writes and releases its writer lease after failure', async () => {
    const p = join(await mkdtemp(join(tmpdir(), 'funding-')), 'data.json'); const store = new FundingStore(p);
    await store.update(d => [importCsv(d, 'customers', file('customers'), undefined, 'x', now), undefined]);
    const before = readFileSync(p, 'utf8');
    await expect(store.update(d => { d.customers[0].credit_limit = '1'; return [d, undefined]; })).rejects.toThrow();
    expect(readFileSync(p, 'utf8')).toBe(before);
    await store.update(d => [importCsv(d, 'customers', file('customers'), undefined, 'x', now), undefined]);
    expect((await store.load()).customers).toHaveLength(1);
  });
  it('refuses a concurrent process writer lock', async () => { const p = join(await mkdtemp(join(tmpdir(), 'funding-')), 'data.json'); await mkdir(`${p}.writer`); await expect(new FundingStore(p).update(d => [d, undefined])).rejects.toThrow(/Another writer/); });
  it('will not silently reset a corrupt store', async () => { const p = join(await mkdtemp(join(tmpdir(), 'funding-')), 'data.json'); await writeFile(p, '{}'); await expect(new FundingStore(p).load()).rejects.toThrow(/Restore/); });
  it('serializes concurrent imports without losing records', async () => { const p = join(await mkdtemp(join(tmpdir(), 'funding-')), 'data.json'); await Promise.all([1, 2].map(i => new FundingStore(p).update(d => [importCsv(d, 'customers', file('customers').replaceAll('customer-1', `customer-${i}`), undefined, 'x', now), undefined]))); expect((await new FundingStore(p).load()).customers).toHaveLength(2); });
});
