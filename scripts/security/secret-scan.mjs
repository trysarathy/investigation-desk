#!/usr/bin/env node
// v1 E1 (phase 5.1): an in-repo secret scanner. No dependency, no network: it reads files and `git` output only.
//
//   node scripts/security/secret-scan.mjs --tree               every file git tracks
//   node scripts/security/secret-scan.mjs --diff origin/main   only lines ADDED since that ref (pull requests)
//
// Two kinds of rule:
//   1. high-signal token shapes (cloud keys, GitHub/Slack/Stripe/Anthropic/OpenAI/Google tokens, private key blocks,
//      connection strings with an inline password that looks random);
//   2. an entropy rule: a quoted value of 20+ characters assigned to a secret-looking name (secret, token, password,
//      api_key, private_key ...) whose Shannon entropy is at least 3.5 bits per character.
// A finding prints the path, line, rule and an 8-hex fingerprint (sha256 of the matched text) — never the value.
// Accepted findings (fictional test fixtures) go in .github/security/secret-scan-allowlist.json by path + fingerprint,
// each with a reason; a line may also carry the marker `secret-scan: allow` with a reason after it.
//
// Exit codes: 0 clean, 1 findings, 2 usage error.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const RULES = [
  { id: 'private-key-block', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----/ },
  { id: 'aws-access-key-id', re: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA|AIPA)[0-9A-Z]{16}\b/ },
  { id: 'github-token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{60,255})\b/ },
  { id: 'slack-token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'slack-webhook', re: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{20,}/ },
  { id: 'stripe-live-key', re: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/ },
  { id: 'anthropic-api-key', re: /\bsk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{40,}\b/ },
  { id: 'openai-api-key', re: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}\b/ },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: 'sendgrid-key', re: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/ },
  { id: 'npm-token', re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\b/ },
  // A connection string with an inline password: flagged only when the password looks random (entropy rule below).
  { id: 'url-with-password', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@'"`]+:([^\s@/'"`]{12,})@[^\s'"`]+/i, entropyGroup: 1 },
  {
    id: 'high-entropy-assignment',
    // The NAME must END with the secret word (api_key, clientSecret, DB_PASSWORD), so token_contract or tokenSymbol never match.
    re: /(?:^|[^A-Za-z0-9])[A-Za-z0-9_-]*?(?:secret|token|passw(?:or)?d|pwd|api[_-]?key|apikey|private[_-]?key|auth[_-]?key|access[_-]?key|signing[_-]?key)["'`]?\s*[:=]\s*["'`]([^"'`\s]{20,})["'`]/i,
    entropyGroup: 1,
  },
];

export const MIN_ENTROPY = 3.5;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const SKIP_PATH = /(^|\/)(node_modules|\.next|\.next-demo|test-results|playwright-report)\/|package-lock\.json$|\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|otf|mp4|webm|xlsx|sqlite)$/i;

/** Shannon entropy in bits per character. */
export function entropy(s) {
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const c of counts.values()) { const p = c / s.length; h -= p * Math.log2(p); }
  return h;
}

export const fingerprint = (text) => createHash('sha256').update(text).digest('hex').slice(0, 8);

/** Findings in one file's text. `lineNumbers` maps the text's lines to file lines (diff mode); identity otherwise. Pure. */
export function scanText(path, text, lineNumbers) {
  const out = [];
  const lines = text.split('\n');
  lines.forEach((l, i) => {
    if (/secret-scan:\s*allow\b/.test(l)) return;
    for (const rule of RULES) {
      const m = rule.re.exec(l);
      if (!m) continue;
      if (rule.entropyGroup !== undefined) {
        const v = m[rule.entropyGroup] ?? '';
        // Placeholders and references are not secrets: ${VAR}, <placeholder>, process.env.X, xxxx, ****.
        // URLs (credentials in a URL are the url-with-password rule's job) and values that say they are not real
        // (fictional, example, fake, placeholder, replace-with ...) are not findings; chain addresses and transaction
        // hashes are public identifiers, not secrets.
        if (/^https?:\/\/[^@]*$/i.test(v) || /example|fictional|fake|not[-_]?real|placeholder|replace[-_]?with|dummy|changeme|test[-_]?only|synthetic|fixture/i.test(v) || v.includes("${")) continue;
        if (/^\$\{|^<|process\.env|^[x*.\-_]+$/i.test(v) || /^0x[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(v) || /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(v) || entropy(v) < MIN_ENTROPY) continue;
      }
      out.push({ path, line: lineNumbers ? lineNumbers[i] : i + 1, rule: rule.id, fingerprint: fingerprint(m[0]) });
    }
  });
  return out;
}

export function parseAllowlist(json) {
  if (!json || !Array.isArray(json.allowed)) throw new Error('allow-list must be {"allowed": [...]}');
  for (const e of json.allowed) {
    if (typeof e.path !== 'string' || !/^[0-9a-f]{8}$/.test(String(e.fingerprint))) throw new Error(`allow-list entry needs path and an 8-hex fingerprint: ${JSON.stringify(e)}`);
    if (typeof e.reason !== 'string' || e.reason.trim().length < 15) throw new Error(`allow-list entry ${e.path} ${e.fingerprint} needs a reason`);
  }
  return json.allowed;
}

export function applyAllowlist(findings, allowed) {
  const key = (p, f) => `${p}\0${f}`;
  const ok = new Set(allowed.map((e) => key(e.path, e.fingerprint)));
  return findings.filter((f) => !ok.has(key(f.path, f.fingerprint)));
}

/** Added lines per file from `git diff --unified=0 <base>...HEAD` output. Pure. */
export function addedLines(diff) {
  const files = new Map();
  let path = null, n = 0;
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++ ')) { path = l === '+++ /dev/null' ? null : l.replace(/^\+\+\+ b\//, ''); continue; }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (h) { n = Number(h[1]); continue; }
    if (path && l.startsWith('+')) {
      const f = files.get(path) ?? { lines: [], numbers: [] };
      f.lines.push(l.slice(1)); f.numbers.push(n++); files.set(path, f);
    }
  }
  return files;
}

function readTracked(path) {
  try {
    if (statSync(path).size > MAX_FILE_BYTES) return undefined;
    const b = readFileSync(path);
    return b.includes(0) ? undefined : b.toString('utf8');
  } catch { return undefined; }
}

export function scanTree(cwd = process.cwd()) {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean);
  const out = [];
  for (const f of files) {
    if (SKIP_PATH.test(f)) continue;
    const text = readTracked(`${cwd}/${f}`);
    if (text !== undefined) out.push(...scanText(f, text));
  }
  return { scanned: files.length, findings: out };
}

export function scanDiff(base, cwd = process.cwd()) {
  const diff = execFileSync('git', ['diff', '--unified=0', '--no-color', '--no-ext-diff', `${base}...HEAD`], { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const out = [];
  let scanned = 0;
  for (const [path, f] of addedLines(diff)) {
    if (SKIP_PATH.test(path)) continue;
    scanned++;
    out.push(...scanText(path, f.lines.join('\n'), f.numbers));
  }
  return { scanned, findings: out };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const allowPath = args.includes('--allowlist') ? args[args.indexOf('--allowlist') + 1] : '.github/security/secret-scan-allowlist.json';
  let result;
  try {
    if (args[0] === '--tree') result = scanTree();
    else if (args[0] === '--diff' && args[1]) result = scanDiff(args[1]);
    else { console.error('usage: secret-scan.mjs --tree | --diff <base-ref> [--allowlist file]'); process.exit(2); }
    const allowed = parseAllowlist(JSON.parse(readFileSync(allowPath, 'utf8')));
    const left = applyAllowlist(result.findings, allowed);
    for (const f of left) console.log(`${f.path}:${f.line}: ${f.rule} (fingerprint ${f.fingerprint})`);
    console.log(`secret scan: ${result.scanned} file(s), ${result.findings.length} finding(s), ${result.findings.length - left.length} allow-listed, ${left.length} open`);
    process.exit(left.length ? 1 : 0);
  } catch (e) {
    console.error(`secret-scan: ${e.message}`);
    process.exit(2);
  }
}
