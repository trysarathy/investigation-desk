/**
 * `npm run demo:feedback` — export the presenter feedback notes ("Note feedback" on every screen of the demo build)
 * to docs/demo/FEEDBACK_<YYYY-MM-DD>.md (today's date on this machine, UTC). It reads the notes still in the demo
 * database and the ones a reset saved to .demo/feedback/ before dropping them (src/server/demo-reset.ts), once each.
 * The notes are a presenter's words about fictional screens; the export names the demo login that wrote each one.
 * Demo · fictional data.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { DB, DemoStop, FEEDBACK_DIR, ROOT, readState, withDb } from "./lib";

interface Note { id: string; created_at: string; role: string; screen: string; route: string; note: string; email: string; name: string; org: string }

const ROLE: Record<string, string> = { admin: "Admin", payment_ops: "Payment Operations", finance: "Finance", approver: "Approver", viewer: "Viewer", provider_admin: "Provider Admin", provider_ops: "Provider Ops" };
const when = (iso: string) => `${new Date(iso).toISOString().slice(0, 16).replace("T", " ")} UTC`;

export function feedbackMarkdown(notes: Note[], day: string): string {
  const byScreen = new Map<string, Note[]>();
  for (const n of [...notes].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1))) {
    const k = `${n.screen}\u0000${n.route.split("?")[0]}`;
    byScreen.set(k, [...(byScreen.get(k) ?? []), n]);
  }
  const out = [
    `# Demo feedback, ${day}`,
    "",
    "Notes saved with \"Note feedback\" in the Clearline demo build (Demo · fictional data): the screen, its address, the",
    "demo login and role, the time (machine clock) and the note. Exported by `npm run demo:feedback`.",
    "",
    `${notes.length} note(s) on ${byScreen.size} screen(s).`,
  ];
  for (const [k, ns] of byScreen) {
    const [screen, route] = k.split("\u0000");
    out.push("", `## ${screen} (\`${route}\`)`, "");
    for (const n of ns) {
      out.push(`- ${when(n.created_at)} · ${ROLE[n.role] ?? n.role} (${n.email}) · \`${n.route}\``);
      for (const line of n.note.split(/\r?\n/)) out.push(`  > ${line}`);
    }
  }
  return `${out.join("\n")}\n`;
}

async function main() {
  const s = readState();
  if (!s) throw new DemoStop("There is no demo here yet: run `npm run demo` first.");
  const notes = new Map<string, Note>();
  if (existsSync(FEEDBACK_DIR)) {
    for (const f of readdirSync(FEEDBACK_DIR).filter((x) => x.endsWith(".json")).sort()) {
      for (const n of (JSON.parse(readFileSync(path.join(FEEDBACK_DIR, f), "utf8")) as { notes: Note[] }).notes) notes.set(n.id, { ...n, created_at: new Date(n.created_at).toISOString() });
    }
  }
  const c = new Client({ connectionString: withDb(s.pg.superUrl, DB) });
  await c.connect();
  try {
    const { rows } = await c.query(`select f.id, f.created_at, f.role, f.screen, f.route, f.note, u.email, u.name, o.name as org
      from demo_feedback f join users u on u.id = f.user_id join organizations o on o.id = f.org_id order by f.created_at, f.id`);
    for (const n of rows as Note[]) notes.set(n.id, { ...n, created_at: new Date(n.created_at).toISOString() });
  } finally { await c.end(); }
  const day = new Date().toISOString().slice(0, 10);
  // CLEARLINE_DEMO_FEEDBACK_OUT: another folder (the demo browser suite writes to test-results/, not docs/)
  const file = path.join(process.env.CLEARLINE_DEMO_FEEDBACK_OUT ? path.resolve(process.env.CLEARLINE_DEMO_FEEDBACK_OUT) : path.join(ROOT, "docs/demo"), `FEEDBACK_${day}.md`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, feedbackMarkdown([...notes.values()], day));
  process.stdout.write(`${notes.size} feedback note(s) written to ${path.relative(ROOT, file)}. Demo · fictional data.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().catch((e: unknown) => {
    process.stderr.write(`\nnpm run demo:feedback stopped: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = e instanceof DemoStop ? 2 : 1;
  });
}
