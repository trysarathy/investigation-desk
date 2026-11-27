#!/usr/bin/env node
// v1 E1 (phase 5.1): the dependency vulnerability gate.
//
//   npm audit --omit=dev --json > audit.json ; node scripts/security/audit-gate.mjs audit.json
//
// Threshold (docs/security/ASVS_L2.md, V14.2): an advisory of severity HIGH or CRITICAL in a production dependency
// fails the gate unless it is on the allow-list (.github/security/audit-allowlist.json) with a reason and an expiry
// that has not passed. MODERATE and LOW advisories are reported, never fail. An expired allow-list entry fails the gate
// (an accepted risk is re-decided, never kept by default). An allow-list entry that matches nothing is reported so the
// list stays short. The report prints advisory ids, packages and severities only.
//
// Exit codes: 0 pass, 1 fail, 2 unusable input.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const FAIL_AT = ['high', 'critical'];
/** An accepted risk is re-decided at least this often. */
export const MAX_ACCEPT_DAYS = 90;
const ORDER = ['info', 'low', 'moderate', 'high', 'critical'];

/** Advisory id from an npm audit "via" object: the GHSA id from its URL, else npm's numeric source id. */
export function advisoryId(via) {
  const m = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i.exec(String(via.url ?? ''));
  return m ? m[0] : `npm-${via.source}`;
}

/** Every distinct advisory in an npm audit v2 report, with the packages it reaches. */
export function advisories(report) {
  if (!report || typeof report !== 'object' || report.auditReportVersion !== 2 || typeof report.vulnerabilities !== 'object') {
    throw new Error('not an npm audit v2 JSON report (run npm audit --json with npm 7 or later)');
  }
  const byId = new Map();
  for (const v of Object.values(report.vulnerabilities)) {
    for (const via of v.via ?? []) {
      if (typeof via !== 'object' || via === null) continue; // a string "via" points at another package's entry
      const id = advisoryId(via);
      const a = byId.get(id) ?? { id, title: String(via.title ?? ''), severity: String(via.severity ?? 'info'), packages: new Set() };
      a.packages.add(String(via.name ?? v.name));
      byId.set(id, a);
    }
  }
  return [...byId.values()].map((a) => ({ ...a, packages: [...a.packages].sort() })).sort((x, y) => ORDER.indexOf(y.severity) - ORDER.indexOf(x.severity) || x.id.localeCompare(y.id));
}

/** Validates the allow-list file's shape; returns its entries. */
export function parseAllowlist(json) {
  if (!json || !Array.isArray(json.accepted)) throw new Error('allow-list must be {"accepted": [...]}');
  for (const e of json.accepted) {
    if (typeof e.id !== 'string' || !/^(GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}|npm-\d+)$/i.test(e.id)) throw new Error(`allow-list entry has no valid id: ${JSON.stringify(e.id)}`);
    if (typeof e.reason !== 'string' || e.reason.trim().length < 20) throw new Error(`allow-list entry ${e.id} needs a reason of at least 20 characters`);
    if (typeof e.expires !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.expires)) throw new Error(`allow-list entry ${e.id} needs expires: YYYY-MM-DD`);
    if (typeof e.owner !== 'string' || !e.owner.trim()) throw new Error(`allow-list entry ${e.id} needs an owner`);
  }
  return json.accepted;
}

/** The decision. `today` is YYYY-MM-DD (UTC). Pure. */
export function evaluate(report, allowlist, today) {
  const found = advisories(report);
  const entries = parseAllowlist(allowlist);
  const byId = new Map(entries.map((e) => [e.id.toUpperCase(), e]));
  const failures = [], accepted = [], reported = [], expired = [];
  const limit = new Date(Date.parse(`${today}T00:00:00Z`) + MAX_ACCEPT_DAYS * 86_400_000).toISOString().slice(0, 10);
  const tooLong = entries.filter((e) => e.expires > limit).map((e) => e.id);
  for (const a of found) {
    const entry = byId.get(a.id.toUpperCase());
    if (entry && entry.expires < today) { expired.push({ ...a, expires: entry.expires }); continue; }
    if (entry) { accepted.push({ ...a, expires: entry.expires }); continue; }
    (FAIL_AT.includes(a.severity) ? failures : reported).push(a);
  }
  const seen = new Set(found.map((a) => a.id.toUpperCase()));
  const unused = entries.filter((e) => !seen.has(e.id.toUpperCase())).map((e) => e.id);
  // An expired entry fails even if the advisory has gone (keep the list honest).
  const expiredUnused = entries.filter((e) => !seen.has(e.id.toUpperCase()) && e.expires < today).map((e) => e.id);
  return { ok: failures.length === 0 && expired.length === 0 && expiredUnused.length === 0 && tooLong.length === 0, failures, accepted, reported, expired, unused, expiredUnused, tooLong };
}

function line(a) { return `  ${a.severity.padEnd(8)} ${a.id}  ${a.packages.join(', ')}${a.title ? `  (${a.title.slice(0, 90)})` : ''}`; }

export function render(r) {
  const out = [];
  if (r.failures.length) out.push(`FAIL: ${r.failures.length} advisory(ies) at or above "${FAIL_AT[0]}" not on the allow-list:`, ...r.failures.map(line));
  if (r.expired.length) out.push(`FAIL: ${r.expired.length} allow-list entry(ies) expired; re-decide each one:`, ...r.expired.map((a) => `${line(a)}  expired ${a.expires}`));
  if (r.expiredUnused.length) out.push(`FAIL: expired allow-list entries that match nothing; remove them: ${r.expiredUnused.join(', ')}`);
  if (r.tooLong.length) out.push(`FAIL: allow-list entries expire more than ${MAX_ACCEPT_DAYS} days out; shorten them: ${r.tooLong.join(', ')}`);
  if (r.accepted.length) out.push(`accepted (allow-list, until the date shown):`, ...r.accepted.map((a) => `${line(a)}  until ${a.expires}`));
  if (r.reported.length) out.push(`reported, below the threshold:`, ...r.reported.map(line));
  if (r.unused.length) out.push(`note: allow-list entries that match no current advisory: ${r.unused.join(', ')}`);
  out.push(r.ok ? 'dependency audit: PASS' : 'dependency audit: FAIL');
  return out.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [reportPath, allowPath = '.github/security/audit-allowlist.json'] = process.argv.slice(2);
  try {
    const report = JSON.parse(readFileSync(reportPath ?? 0, 'utf8'));
    const allow = JSON.parse(readFileSync(allowPath, 'utf8'));
    const r = evaluate(report, allow, new Date().toISOString().slice(0, 10));
    console.log(render(r));
    process.exit(r.ok ? 0 : 1);
  } catch (e) {
    console.error(`audit-gate: ${e.message}`);
    process.exit(2);
  }
}
