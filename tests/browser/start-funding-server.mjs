import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const port = process.argv[2];
if (!['3000', '3001'].includes(port)) throw Error('Browser fixture port must be 3000 or 3001.');
if (!process.env.CLEARLINE_BROWSER_PASSWORD) throw Error('Missing synthetic fixture password.');
const parent = await mkdtemp(path.join(tmpdir(), 'clearline-browser-'));
const dir = path.join(parent, 'store');
await mkdir('funding-browser-artifacts', { recursive: true });
const log = createWriteStream(`funding-browser-artifacts/server-${port}.log`);
const env = {
  ...process.env,
  NEXT_TELEMETRY_DISABLED: '1',
  CLEARLINE_BOOTSTRAP_PASSWORD: process.env.CLEARLINE_BROWSER_PASSWORD,
  CLEARLINE_FUNDING_ONLY: '1',
  CLEARLINE_FUNDING_DIR: dir,
  CLEARLINE_ORIGIN: `http://127.0.0.1:${port}`,
};
let child;
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  if (child && child.exitCode === null) child.kill('SIGTERM');
  log.end();
  await rm(parent, { recursive: true, force: true });
  process.exit(code);
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
try {
  const setup = spawn('npm', ['run', 'funding-setup', '--', '--sample', '--dir', dir], { env });
  setup.stdout.pipe(log, { end: false });
  setup.stderr.pipe(log, { end: false });
  const code = await new Promise((resolve, reject) => {
    setup.on('error', reject);
    setup.on('exit', resolve);
  });
  if (code !== 0) throw Error(`Synthetic bootstrap failed (${code}); inspect server-${port}.log.`);
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', port], { env });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.on('error', error => { console.error(error.message); void stop(1); });
  child.on('exit', code => void stop(code ?? 1));
} catch (error) {
  console.error(error.message);
  await stop(1);
}
