#!/usr/bin/env node
/**
 * v1 phase 5.4 CI check: no console call logs a request body (or a parsed body, a form, an uploaded file's content).
 * Scans src/ and scripts/ (.ts, .tsx, .js, .mjs, .cjs) for console.log/info/warn/error/debug/trace(...) and
 * process.stdout/stderr.write(...) whose arguments mention a body: `req.body`, `request.json()`, `.text()`,
 * `.formData()`, `.arrayBuffer()`, or an identifier named body, rawBody, requestBody, payload, formData or form.
 * A line can opt out only with a reason: `// log-safety: allow <why>`.
 *   node scripts/ops/check-log-safety.mjs [dir ...]      exit 0 clean, 1 findings (file:line printed), 2 usage
 * Logs should use src/server/ops/log.ts (scrubbed JSON lines) anyway; this catches the direct console call.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const EXT = /\.(ts|tsx|js|mjs|cjs)$/;
const SKIP_DIR = new Set(["node_modules", ".next", ".next-demo", "dist", "coverage", ".git"]);
const CALL = /\b(console\s*\.\s*(?:log|info|warn|error|debug|trace)|process\s*\.\s*(?:stdout|stderr)\s*\.\s*write)\s*\(/g;
const BODY = [
  /\b\w+\s*\.\s*body\b/, // req.body, request.body, res.body
  /\.\s*(?:json|text|formData|arrayBuffer|blob)\s*\(\s*\)/, // await request.json()
  /(?<![.\w"'`])(?:body|rawBody|requestBody|reqBody|payload|formData|form|fileContent|fileText|csvText)(?![\w"'`])/,
];
const ALLOW = /\/\/\s*log-safety:\s*allow\s+\S+/;

/** The text between the call's parentheses (strings and template literals skipped while counting). */
function argsAt(src, open) {
  let depth = 1, i = open + 1, quote = null;
  for (; i < src.length && depth > 0; i++) {
    const c = src[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
  }
  return src.slice(open + 1, i - 1);
}

/**
 * String literals blanked so a message such as "body too large" is not a finding; a template literal keeps only its
 * ${...} expressions (those are code and are checked).
 */
function stripStrings(s) {
  let out = "", i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < s.length && s[j] !== c) j += s[j] === "\\" ? 2 : 1;
      out += '""'; i = j + 1;
    } else if (c === "`") {
      let j = i + 1;
      out += '"" ';
      while (j < s.length && s[j] !== "`") {
        if (s[j] === "\\") { j += 2; continue; }
        if (s[j] === "$" && s[j + 1] === "{") {
          let depth = 1, k = j + 2;
          while (k < s.length && depth > 0) { if (s[k] === "{") depth++; else if (s[k] === "}") depth--; k++; }
          out += ` ${stripStrings(s.slice(j + 2, k - 1))} `; j = k; continue;
        }
        j++;
      }
      i = j + 1;
    } else { out += c; i++; }
  }
  return out;
}

export function findingsIn(src, file = "<input>") {
  const out = [];
  for (const m of src.matchAll(CALL)) {
    const open = m.index + m[0].length - 1;
    const args = stripStrings(argsAt(src, open));
    if (!BODY.some((re) => re.test(args))) continue;
    const line = src.slice(0, m.index).split("\n").length;
    const lineText = src.split("\n")[line - 1] ?? "";
    if (ALLOW.test(lineText)) continue;
    out.push({ file, line, call: m[1].replace(/\s+/g, "") });
  }
  return out;
}

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, files);
    else if (EXT.test(name)) files.push(p);
  }
  return files;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const dirs = process.argv.slice(2).length ? process.argv.slice(2) : ["src", "scripts"];
  const findings = [];
  for (const d of dirs) {
    try { statSync(d); } catch { console.error(`check-log-safety: no such directory: ${d}`); process.exit(2); }
    for (const f of walk(d)) findings.push(...findingsIn(readFileSync(f, "utf8"), f));
  }
  if (findings.length) {
    for (const f of findings) console.error(`${f.file}:${f.line}: ${f.call}(...) mentions a request body; log ids, codes and counts via src/server/ops/log.ts`);
    console.error(`check-log-safety: ${findings.length} finding(s)`);
    process.exit(1);
  }
  console.log("check-log-safety: no console call logs a request body");
}
