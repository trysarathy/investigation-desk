import { readFileSync, mkdirSync, writeFileSync, renameSync, rmSync, mkdtempSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { replay, exportCsv, openColumns, exceptionColumns } from '../src/lib/advances/ledger.js';

try {
  const [mode, payouts, bank, asOf, output, ...extra] = process.argv.slice(2);
  if (mode !== '--synthetic-only' || !output || extra.length) throw Error('Usage: npm run owed-ledger -- --synthetic-only payouts.csv bank.csv YYYY-MM-DDTHH:mm:ssZ NEW_OUTPUT_DIRECTORY');
  const decode = (path: string) => new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(path));
  const result = replay(decode(payouts), decode(bank), asOf);
  const target = resolve(output);
  mkdirSync(dirname(target), { recursive: true });
  const stage = mkdtempSync(`${target}.staging-`);
  try {
    writeFileSync(`${stage}/open-advances.csv`, exportCsv(result.rows, openColumns));
    writeFileSync(`${stage}/exceptions.csv`, exportCsv(result.exceptions, exceptionColumns));
    renameSync(stage, target);
  } finally { rmSync(stage, { recursive: true, force: true }); }
  console.log(`SYNTHETIC ONLY: ${result.rows.length} open advances; ${result.exceptions.length} exceptions. ${target}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
}
