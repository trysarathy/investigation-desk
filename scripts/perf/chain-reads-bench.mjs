// v1 phase 0: the chain_reads hot-query benchmark (docs/perf/CHAIN_READS_PARTITIONING.md). FICTIONAL data only (seed
// with scripts/perf/chain-reads-seed.sql first). Runs every query as the runtime login under row-level security, in a
// transaction with the same app.user_id / app.org_id settings the app sets (src/server/tenant.ts), with
// EXPLAIN (ANALYZE, BUFFERS); one warm-up, then the median of 5. Writes nothing (the insert is rolled back).
//   RUNTIME_URL=postgres://clearline_runtime:...@host/db node scripts/perf/chain-reads-bench.mjs [label] [plans-out.txt]
import { writeFileSync } from "node:fs";
import pg from "pg";

const A = "00000000-0000-4000-8000-00000000000a", B = "00000000-0000-4000-8000-00000000000b", P = "00000000-0000-4000-8000-0000000000f0";
const asA = { user: "bench-user-a", org: A }, asB = { user: "bench-user-b", org: B }, asP = { user: "bench-user-p", org: P };
const insertRows = Array.from({ length: 1000 }, (_, i) =>
  `('${A}','a-1','tron',NULL,md5('bench-insert-${i}'),'ok',NULL,'recording','rpc.example.invalid','eth_getTransactionReceipt',1,timestamptz '2026-11-30 03:00:00+00')`).join(",");

// The queries the app runs (src/server/merchant-store.ts unavailableReads, src/server/chain-verify.ts insert), plus the
// provider read path, a whole-table count (the isolation tests' query) and a one-month window (not used by the app yet).
const QUERIES = [
  { id: "Q1", what: "loader probe: any unavailable read (a-1: none, scans every read of the entity)", as: asA,
    sql: `select id from chain_reads where org_id = '${A}' and entity_id = 'a-1' and status = 'unavailable' limit 1` },
  { id: "Q2", what: "loader: transaction reads of a-1 (864k-row entity), ordered", as: asA,
    sql: `select * from chain_reads where org_id = '${A}' and entity_id = 'a-1' and tx_hash is not null order by at, id` },
  { id: "Q3", what: "loader probe: any unavailable read (a-2: has some)", as: asA,
    sql: `select id from chain_reads where org_id = '${A}' and entity_id = 'a-2' and status = 'unavailable' limit 1` },
  { id: "Q4", what: "loader: every read of a-2 (96k rows, outage path), ordered", as: asA,
    sql: `select * from chain_reads where org_id = '${A}' and entity_id = 'a-2' order by at, id` },
  { id: "Q5", what: "loader: transaction reads of b-1 (small merchant, 48k rows), ordered", as: asB,
    sql: `select * from chain_reads where org_id = '${B}' and entity_id = 'b-1' and tx_hash is not null order by at, id` },
  { id: "Q6", what: "chain-verify write: insert one 1000-row chunk (rolled back)", as: asA, write: true,
    sql: `insert into chain_reads (org_id, entity_id, network, address, tx_hash, status, reason, source, host, endpoint, transfers, at) values ${insertRows}` },
  { id: "Q7", what: "provider (full grant) reads merchant A's a-2 reads", as: asP,
    sql: `select * from chain_reads where org_id = '${A}' and entity_id = 'a-2' order by at, id` },
  { id: "Q8", what: "count(*) of every visible read as merchant B (isolation-test query)", as: asB,
    sql: `select count(*) from chain_reads` },
  { id: "Q9", what: "one month of a-1's reads (2026-11; illustrative, not an app query)", as: asA,
    sql: `select * from chain_reads where org_id = '${A}' and entity_id = 'a-1' and at >= '2026-11-01' and at < '2026-12-01' order by at, id` },
];

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

async function explain(client, q) {
  await client.query("begin");
  try {
    await client.query("select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [q.as.user, q.as.org]);
    const r = await client.query(`explain (analyze, buffers, format json) ${q.sql}`);
    const text = q.keepPlan ? (await client.query(`explain (analyze, buffers, costs off, timing off, summary off) ${q.sql}`)).rows.map((x) => x["QUERY PLAN"]).join("\n") : "";
    return { plan: r.rows[0]["QUERY PLAN"][0], text };
  } finally { await client.query("rollback"); }
}

async function main() {
  const url = process.env.RUNTIME_URL;
  if (!url) throw new Error("set RUNTIME_URL to the runtime login of a benchmark database");
  const [label = "run", plansOut] = process.argv.slice(2);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const who = (await client.query("select current_user, rolbypassrls, rolsuper from pg_roles where rolname = current_user")).rows[0];
  if (who.rolbypassrls || who.rolsuper) throw new Error("refusing: this login bypasses row-level security");
  const rows = [], plans = [];
  for (const q of QUERIES) {
    await explain(client, q); // warm-up
    const exec = [], plan = [], hit = [], read = [];
    let last;
    for (let i = 0; i < 5; i++) {
      last = (await explain(client, q)).plan;
      exec.push(last["Execution Time"]); plan.push(last["Planning Time"]);
      hit.push(last["Planning"]?.["Shared Hit Blocks"] ?? 0); read.push(last.Plan["Shared Hit Blocks"] + last.Plan["Shared Read Blocks"]);
    }
    const t = (await explain(client, { ...q, keepPlan: true })).text;
    rows.push({ id: q.id, what: q.what, rows: last.Plan["Actual Rows"], execMs: median(exec), planMs: median(plan), buffers: median(read) });
    plans.push(`--- ${q.id} (${label}): ${q.what}\n${t}\n`);
  }
  await client.end();
  console.log(`| query | rows | execution ms (median of 5) | planning ms (median of 5) | shared buffers |`);
  console.log(`|---|---:|---:|---:|---:|`);
  for (const r of rows) console.log(`| ${r.id} ${r.what} | ${r.rows} | ${r.execMs.toFixed(2)} | ${r.planMs.toFixed(2)} | ${r.buffers} |`);
  if (plansOut) writeFileSync(plansOut, plans.join("\n"));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
