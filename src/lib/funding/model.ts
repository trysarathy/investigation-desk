import { add, sub } from '../payments/money';
export type Currency = 'SGD' | 'USD';
export type Role = 'operator' | 'approver' | 'viewer';
export interface User { id: string; name: string; role: Role; }
export interface Evidence { id: string; effective_at: string; known_at: string; source: string; }
export interface Customer extends Evidence { name: string; currency: Currency; credit_limit: string; terms: string; status: 'active' | 'suspended'; }
export type AdvanceState = 'proposed' | 'prepared' | 'approved' | 'declined' | 'supplier_paid' | 'partly_repaid' | 'repaid' | 'overdue' | 'written_off';
export interface Advance extends Evidence { customer_id: string; supplier: string; invoice_ref: string; amount: string; currency: Currency; account: string; payout_at: string; due_at: string; state: AdvanceState; }
export interface Payout extends Evidence { advance_id: string; account: string; amount: string; currency: Currency; reference: string; }
export interface Receipt extends Evidence { customer_id: string; reference: string; account: string; amount: string; currency: Currency; }
export type Classification = 'free' | 'safeguarded customer money' | 'pending payouts' | 'buffer';
export interface CashPosition extends Evidence { snapshot_id: string; account: string; balance: string; currency: Currency; classification: Classification; amount: string; }
export interface Decision extends Evidence { advance_id: string; actor_id: string; outcome: 'approve' | 'decline'; reason: string; prepared_by: string; revision: number; }
export interface InputRows { customers: Customer[]; advances: Advance[]; payouts: Payout[]; receipts: Receipt[]; cash: CashPosition[]; }
export type ImportKind = keyof InputRows;
export type ColumnMapping = Record<string, string>;
export interface ImportBatch { id: string; kind: ImportKind; filename: string; sha256: string; text: string; mapping: ColumnMapping; imported_at: string; accepted: number; duplicates: string[]; }
export interface FundingData extends InputRows { version: 1; revision: number; mappings: Partial<Record<ImportKind, ColumnMapping>>; imports: ImportBatch[]; decisions: Decision[]; users: User[]; }
export const emptyFunding = (): FundingData => ({ version: 1, revision: 0, mappings: {}, imports: [], customers: [], advances: [], payouts: [], receipts: [], cash: [], decisions: [], users: [] });
export function amount(value: string): string {
  if (!/^(0|[1-9]\d{0,14})(\.\d{1,2})?$/.test(value)) throw Error('Use a nonnegative amount with at most two decimal places.');
  return add(value, '0');
}
export function instant(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value.replace('Z', '.000Z')) throw Error('Use a real UTC date and time, for example 2026-11-07T09:00:00Z.');
  return Date.parse(value);
}
export const visible = (row: Evidence, at: string) => instant(row.known_at) <= instant(at) && instant(row.effective_at) <= instant(at);
export const compare = (a: string, b: string) => { const delta = sub(a, b); return delta === '0' ? 0 : delta.startsWith('-') ? -1 : 1; };
