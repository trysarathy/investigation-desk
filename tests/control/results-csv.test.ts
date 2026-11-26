/**
 * v1 overnight against PostgreSQL 16: the results CSVs (open exceptions, matched payments). Each holds only the
 * signed-in organisation's rows; a cell that could run as a spreadsheet formula is written as text; the matched file
 * lists only matched / matched_with_difference decisions. Fictional seed data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeOwner, ownerDb, PASSWORD, resetAndSeed } from "./harness";
import { closeDatabase } from "../../src/server/db/client";
import { resolveTenant } from "../../src/server/tenant";
import { MERCHANT_SEED_ORGS, MERCHANT_SEED_USERS, seedMerchantCases } from "../../src/server/merchant-seed";
import { runReconciliation } from "../../src/server/merchant";
import { resultsCsv } from "../../src/server/exports";

let seed: Awaited<ReturnType<typeof seedMerchantCases>>;
let n = 0;
const key = () => `rc-key-${++n}-${Date.now()}`;
const ctxOf = (email: string, slug: string) => resolveTenant({ userId: seed.users[email], name: email, email }, slug);
const finance = (org: "sg" | "ae") => MERCHANT_SEED_USERS.find((u) => u.role === "finance" && u.org === org)!.email;
const ops = (org: "sg" | "ae") => MERCHANT_SEED_USERS.find((u) => u.role === "payment_ops" && u.org === org)!.email;

beforeAll(async () => {
  await resetAndSeed();
  seed = await seedMerchantCases(ownerDb(), { password: PASSWORD });
  const sg = await ctxOf(ops("sg"), MERCHANT_SEED_ORGS.sg.slug);
  for (const e of ["ENT-SG-01", "ENT-SG-02", "ENT-US-02"]) await runReconciliation(sg, e, key());
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("results CSV", () => {
  it("open exceptions: only this organisation's rows, and a formula-like cell is written as text", async () => {
    const own = (await ownerDb().execute(sql`select e.id from recon_exceptions e join organizations o on o.id = e.org_id where o.slug = ${MERCHANT_SEED_ORGS.sg.slug} and e.status <> 'resolved' order by e.id limit 1`)).rows[0] as { id: string } | undefined;
    expect(own, "the seed has an open exception").toBeTruthy();
    await ownerDb().execute(sql`update recon_exceptions set next_step = '=HYPERLINK("http://example.invalid")' where id = ${own!.id}`);
    const r = await resultsCsv(await ctxOf(finance("sg"), MERCHANT_SEED_ORGS.sg.slug), "exceptions");
    const lines = r.body.trim().split("\r\n");
    expect(lines[0]).toBe("exception_id,order_id,entity,status,owner_role,owner,reason,next_step,opened_at");
    const mine = (await ownerDb().execute(sql`select count(*)::int as n from recon_exceptions e join organizations o on o.id = e.org_id where o.slug = ${MERCHANT_SEED_ORGS.sg.slug} and e.status <> 'resolved'`)).rows[0] as { n: number };
    expect(lines.length - 1).toBe(mine.n);
    const row = lines.find((l) => l.startsWith(own!.id))!;
    expect(row).toContain(`'=HYPERLINK(`);
    expect(row).not.toMatch(/,=HYPERLINK/);
    const others = (await ownerDb().execute(sql`select e.id from recon_exceptions e join organizations o on o.id = e.org_id where o.slug <> ${MERCHANT_SEED_ORGS.sg.slug}`)).rows as { id: string }[];
    for (const o of others) expect(r.body).not.toContain(o.id);
  });

  it("matched payments: only matched decisions of this organisation", async () => {
    const r = await resultsCsv(await ctxOf(finance("sg"), MERCHANT_SEED_ORGS.sg.slug), "matched");
    const lines = r.body.trim().split("\r\n").slice(1);
    const want = (await ownerDb().execute(sql`select m.order_id from match_records m join organizations o on o.id = m.org_id where o.slug = ${MERCHANT_SEED_ORGS.sg.slug} and m.decision in ('matched','matched_with_difference') order by m.order_id`)).rows as { order_id: string }[];
    expect(lines.map((l) => l.split(",")[0])).toEqual(want.map((w) => w.order_id));
    for (const l of lines) expect(l.split(",")[2]).toMatch(/^matched(_with_difference)?$/);
  });

  it("another organisation's Finance sees none of these rows", async () => {
    const ae = await resultsCsv(await ctxOf(finance("ae"), MERCHANT_SEED_ORGS.ae.slug), "exceptions");
    const sgIds = (await ownerDb().execute(sql`select e.id from recon_exceptions e join organizations o on o.id = e.org_id where o.slug = ${MERCHANT_SEED_ORGS.sg.slug}`)).rows as { id: string }[];
    for (const x of sgIds) expect(ae.body).not.toContain(x.id);
  });
});
