/**
 * `npm run demo:totp` — the current 6-digit code of the demo authenticator (the fictional TOTP secret `npm run demo`
 * gave the demo Admin and Approver; local, in .demo/state.json). For a presenter signing in directly as
 * approver@northwind.demo or admin@northwind.demo. A code works once; the next one comes every 30 seconds.
 * Demo · fictional data.
 */
import { demoTotpBase32, demoTotpCode, readState } from "./lib";

const s = readState();
if (!s?.totpSecret) {
  process.stderr.write("No demo authenticator yet: run `npm run demo` (or `npm run demo -- --fresh` for a demo seeded before it existed).\n");
  process.exitCode = 2;
} else {
  const left = 30 - Math.floor(Date.now() / 1000) % 30;
  process.stdout.write(`Demo code: ${demoTotpCode(s.totpSecret)}  (valid ${left}s more; then ${demoTotpCode(s.totpSecret, Date.now() + 30_000)})\n`);
  process.stdout.write(`Authenticator key (fictional, demo only): ${demoTotpBase32(s.totpSecret)}\n`);
}
