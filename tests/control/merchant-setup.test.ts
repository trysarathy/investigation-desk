/**
 * rc8 founder decision 4 against PostgreSQL 16: from a BLANK database, the admin CLI (`npm run control:admin`, run here
 * as a separate process exactly as an operator runs it) creates a provider and a live merchant with an entity, its
 * default policy, the provider link and Finance, Payment Operations, two Approvers, an Admin and a Viewer — then the
 * RUNTIME app works for that merchant with no hand SQL: sign in, save a mapping template, upload and confirm the four
 * files, reconcile, export. The CLI uses DATABASE_OWNER_URL only and refuses without it (or with the runtime login);
 * re-running is a no-op; overwriting is a dry run without --confirm; its output holds ids, roles and counts only.
 * The runtime login cannot create organisations or any entity (v1: not even its own merchant's), and only an Admin may change a
 * policy (the database's rules are unchanged). Fictional values only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { sql } from "drizzle-orm";
import { closeOwner, ownerDb, PASSWORD, resetBlank } from "./harness";
import { useTestStorage, type LiveSeed } from "./upload-harness";
import { liveKey, seedSgLive, type LiveSg } from "./live-data";
import * as sc from "./upload-scenarios";
import { closeDatabase } from "../../src/server/db/client";
import { resolveTenant, withTenant } from "../../src/server/tenant";
import { saveMappingTemplate } from "../../src/server/mapping-templates";
import { merchantShell } from "../../src/server/merchant-ui";
import { monthEndPack } from "../../src/server/exports";
import { POST as authPOST } from "../../src/app/api/auth/[...all]/route";
import { GET as paymentsGET } from "../../src/app/api/control/merchant/payments/route";
import { defaultPolicyFor } from "../../src/lib/clearline/merchant/config";

const run = promisify(execFile);
const TSX = path.resolve("node_modules/.bin/tsx");
const OWNER = process.env.CLEARLINE_TEST_OWNER_URL!, RUNTIME = process.env.CLEARLINE_TEST_RUNTIME_URL!;
const ORIGIN = process.env.CLEARLINE_ORIGIN!;
const M = "first-run-merchant", P = "first-run-provider";
const PEOPLE: [string, string][] = [
  ["finance@live-a.example", "finance"], ["ops@live-a.example", "payment_ops"], ["approver@live-a.example", "approver"], ["approver2@live-a.example", "approver"],
  ["admin@live-a.example", "admin"], ["viewer@live-a.example", "viewer"],
];

interface CliResult { code: number; out: string; err: string; json: Record<string, unknown>[] }
/** Run `scripts/control/admin.ts` as a separate process. DATABASE_URL is removed: the setup commands read DATABASE_OWNER_URL only. */
async function cli(args: string[], env: Record<string, string | undefined> = {}): Promise<CliResult> {
  const base: Record<string, string | undefined> = { ...process.env, DATABASE_URL: undefined, DATABASE_OWNER_URL: OWNER, CLEARLINE_SEED_PASSWORD: undefined, ...env };
  const clean = Object.fromEntries(Object.entries(base).filter((e): e is [string, string] => e[1] !== undefined)) as NodeJS.ProcessEnv;
  const r = await run(TSX, ["--conditions=react-server", "scripts/control/admin.ts", ...args], { env: clean, timeout: 60_000 }).then((x) => ({ code: 0, out: x.stdout, err: x.stderr }),
    (e: { code?: number; stdout?: string; stderr?: string }) => ({ code: typeof e.code === "number" ? e.code : 1, out: e.stdout ?? "", err: e.stderr ?? "" }));
  const json = r.out.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l) as Record<string, unknown>);
  return { ...r, json };
}
const outputs: CliResult[] = [];
async function ok(args: string[], env: Record<string, string | undefined> = {}, code = 0) {
  const r = await cli(args, env);
  outputs.push(r);
  expect([r.code, r.err], args.join(" ")).toEqual([code, ""]);
  return r.json[0];
}
const rows = async (q: ReturnType<typeof sql>) => (await ownerDb().execute(q)).rows as Record<string, unknown>[];

let live: LiveSg;
let seed: LiveSeed;

beforeAll(async () => {
  useTestStorage();
  await resetBlank();
}, 180_000);
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("the admin CLI creates a merchant from a blank database", () => {
  it("starts blank", async () => {
    expect(await rows(sql`select (select count(*)::int from organizations) as orgs, (select count(*)::int from users) as users, (select count(*)::int from merchant_entities) as ents`)).toEqual([{ orgs: 0, users: 0, ents: 0 }]);
  });

  it("refuses without the owner URL, with the runtime login, and does not fall back to DATABASE_URL", async () => {
    for (const env of [{ DATABASE_OWNER_URL: undefined }, { DATABASE_OWNER_URL: undefined, DATABASE_URL: OWNER }]) {
      const r = await cli(["create-merchant", M, "--name", "First Run Trading (fictional)", "--timezone", "Asia/Singapore"], env);
      expect([r.code, r.err.trim()]).toEqual([1, "set DATABASE_OWNER_URL to the schema owner login (clearline_owner); merchant setup never runs on the runtime login"]);
    }
    const r = await cli(["create-merchant", M, "--name", "First Run Trading (fictional)", "--timezone", "Asia/Singapore"], { DATABASE_OWNER_URL: RUNTIME });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/is not the schema owner login/);
    expect(r.err).not.toContain("devruntime_pw");
    expect((await rows(sql`select count(*)::int as n from organizations`))[0].n).toBe(0);
  });

  it("provider, merchant, entity with its default policy, provider link and members; re-running changes nothing", async () => {
    const prov = await ok(["create-provider", P, "--name", "First Run Pay (fictional)", "--timezone", "UTC"]);
    const mer = await ok(["create-merchant", M, "--name", "First Run Trading (fictional)", "--timezone", "Asia/Singapore"]);
    expect([prov.status, mer.status]).toEqual(["created", "created"]);
    expect((await ok(["create-merchant", M, "--name", "First Run Trading (fictional)", "--timezone", "Asia/Singapore"])).status).toBe("exists");
    const clash = await cli(["create-merchant", M, "--name", "Someone else (fictional)", "--timezone", "Asia/Singapore"]);
    expect([clash.code, clash.err.trim()]).toEqual([1, "That slug is already used by a different organisation (kind, data mode, name or time zone differ); nothing changed."]);

    const ent = await ok(["add-entity", M, sc.SG.entityId, "--name", "First Run Trading Pte Ltd (fictional)", "--currency", "SGD", "--timezone", "Asia/Singapore", "--ledger", "xero"]);
    expect(ent).toMatchObject({ status: "created", entityId: sc.SG.entityId, utcOffsetMinutes: 480, policyRevision: 1 });
    expect((await ok(["add-entity", M, sc.SG.entityId, "--name", "First Run Trading Pte Ltd (fictional)", "--currency", "SGD", "--timezone", "Asia/Singapore", "--utc-offset", "+08:00", "--ledger", "xero"])).status).toBe("exists");
    const usd = await cli(["add-entity", M, sc.SG.entityId, "--name", "First Run Trading Pte Ltd (fictional)", "--currency", "USD", "--timezone", "Asia/Singapore", "--ledger", "xero"]);
    expect([usd.code, usd.err]).toEqual([1, expect.stringMatching(/already exists with different values; nothing changed/)]);
    for (const bad of [{ currency: "EUR" }, { timezone: "Mars/Olympus" }, { "utc-offset": "+08:10" }] as Record<string, string>[]) {
      const f: Record<string, string> = { name: "Bad (fictional)", currency: "SGD", timezone: "Asia/Singapore", ...bad };
      expect((await cli(["add-entity", M, "ENT-BAD", ...Object.entries(f).flatMap(([k, v]) => [`--${k}`, v])])).code, JSON.stringify(bad)).toBe(1);
    }
    expect((await rows(sql`select id from merchant_entities`)).map((r) => r.id)).toEqual([sc.SG.entityId]);
    const d = defaultPolicyFor("SGD");
    expect(await rows(sql`select tolerance_bps, tolerance_abs_minor::text as abs, tolerance_combine, writeoff_threshold_minor::text as wo, allow_imported_bank_lines_as_verified as imported, revision from merchant_policy`))
      .toEqual([{ tolerance_bps: d.tolerancePct, abs: d.toleranceAbsMinor.toString(), tolerance_combine: d.toleranceCombine, wo: d.writeoffThresholdMinor.toString(), imported: false, revision: 1 }]);

    // v1: the entity's bank account; only the last four characters of the number are accepted or stored
    const acct = await ok(["add-bank-account", M, sc.SG.entityId, "--name", "SGD operating", "--currency", "SGD", "--last4", "4321", "--bank", "Fictional Bank", "--bic", "FICTSGSGXXX"]);
    expect(acct).toEqual({ status: "created", orgId: mer.orgId, entityId: sc.SG.entityId, bankAccountId: expect.any(String), currency: "SGD", entityCurrency: "SGD" });
    expect(await ok(["add-bank-account", M, sc.SG.entityId, "--name", "SGD operating", "--currency", "SGD", "--last4", "4321", "--bank", "Fictional Bank", "--bic", "FICTSGSGXXX"])).toMatchObject({ status: "exists", bankAccountId: acct.bankAccountId });
    const full = await cli(["add-bank-account", M, sc.SG.entityId, "--name", "USD operating", "--currency", "USD", "--last4", "GB82WEST12345698765432", "--bank", "Fictional Bank"]);
    expect([full.code, full.err.trim()]).toEqual([1, "last four: pass exactly the LAST FOUR letters or digits of the account number; the full number is never stored"]);
    for (const bad of [["--currency", "EUR"], ["--bic", "NOPE"]]) {
      const f: Record<string, string> = { "--name": "Bad", "--currency": "USD", "--last4": "0001", "--bank": "Fictional Bank", [bad[0]]: bad[1] };
      expect((await cli(["add-bank-account", M, sc.SG.entityId, ...Object.entries(f).flat()])).code, bad.join(" ")).toBe(1);
    }
    expect((await cli(["add-bank-account", M, "ENT-NONE", "--name", "X", "--currency", "SGD", "--last4", "0001", "--bank", "Fictional Bank"])).err).toMatch(/No such entity/);
    const clashAcct = await cli(["add-bank-account", M, sc.SG.entityId, "--name", "SGD operating", "--currency", "SGD", "--last4", "9999", "--bank", "Fictional Bank", "--bic", "FICTSGSGXXX"]);
    expect([clashAcct.code, clashAcct.err]).toEqual([1, expect.stringMatching(/different values .*nothing changed/)]);
    expect(await rows(sql`select currency, account_last4, status, created_by from bank_accounts`)).toEqual([{ currency: "SGD", account_last4: "4321", status: "active", created_by: null }]);
    expect(await rows(sql`select actor_user_id, details from audit_events where action = 'bank_account_created'`)).toEqual([{ actor_user_id: null, details: { entityId: sc.SG.entityId, bankAccountId: acct.bankAccountId, currency: "SGD" } }]);

    expect((await ok(["link-provider", M, P])).status).toBe("linked");
    expect((await ok(["link-provider", M, P])).status).toBe("exists");

    // a new person's password only from CLEARLINE_SEED_PASSWORD; without it the CLI refuses and points to the invitation flow
    const nopw = await cli(["add-member", M, PEOPLE[0][0], PEOPLE[0][1]]);
    expect([nopw.code, nopw.err]).toEqual([1, expect.stringMatching(/set CLEARLINE_SEED_PASSWORD .*never an argument.*accept-invitation/)]);
    for (const [email, role] of PEOPLE) expect((await ok(["add-member", M, email, role, "--name", `${role} (fictional)`], { CLEARLINE_SEED_PASSWORD: PASSWORD })).status).toBe("granted");
    expect((await ok(["add-member", P, "admin@provider-a.example", "provider_admin"], { CLEARLINE_SEED_PASSWORD: PASSWORD })).status).toBe("granted");
    expect((await ok(["add-member", M, "finance@live-a.example", "finance"])).status).toBe("exists");
    const wrong = await cli(["add-member", M, "someone@live-a.example", "provider_admin"], { CLEARLINE_SEED_PASSWORD: PASSWORD });
    expect([wrong.code, wrong.err.trim()]).toEqual([1, "role: one of admin, payment_ops, finance, approver, viewer for a merchant"]);
    // changing a member's role is a dry run (exit 2) until --confirm repeats the slug
    const dry = await ok(["add-member", M, "viewer@live-a.example", "approver"], {}, 2);
    expect(dry).toMatchObject({ status: "dry_run", role: "approver", wouldReplaceRole: "viewer" });
    const typo = await cli(["add-member", M, "viewer@live-a.example", "approver", "--confirm", "not-the-slug"]);
    expect([typo.code, typo.err.trim()]).toEqual([1, "--confirm must repeat the organisation's slug exactly; nothing changed."]);
    expect((await rows(sql`select m.role from organization_memberships m join users u on u.id = m.user_id where u.email = 'viewer@live-a.example'`))[0].role).toBe("viewer");

    const sum = await ok(["setup-summary", M]);
    expect(sum).toMatchObject({ slug: M, kind: "merchant", dataMode: "live", providerOrgId: prov.orgId, entities: [{ id: sc.SG.entityId, currency: "SGD", utcOffsetMinutes: 480, policyRevision: 1, bankAccounts: [{ id: acct.bankAccountId, currency: "SGD", status: "active" }] }],
      members: { admin: 1, approver: 2, finance: 1, payment_ops: 1, viewer: 1 } });
  });

  it("set-policy: the Settings page's validation, a dry run until confirmed, then the next revision with an audit row", async () => {
    const tooWide = await cli(["set-policy", M, sc.SG.entityId, "--tolerance-bps", "1001"]);
    expect([tooWide.code, tooWide.err]).toEqual([1, expect.stringMatching(/^policy: toleranceBps .*\(the Settings page's validation\)/)]);
    for (const bad of [["--tolerance-abs-minor", "-5"], ["--combine", "either"], ["--allow-imported-bank-lines", "yes"]]) expect((await cli(["set-policy", M, sc.SG.entityId, ...bad])).code, bad.join(" ")).toBe(1);
    const dry = await ok(["set-policy", M, sc.SG.entityId, "--allow-imported-bank-lines", "true"], {}, 2);
    expect(dry).toEqual({ status: "dry_run", orgId: expect.any(String), entityId: sc.SG.entityId, revision: 1, wouldChange: { allowImportedBankLinesAsVerified: { from: false, to: true } } });
    expect((await rows(sql`select revision from merchant_policy`))[0].revision).toBe(1);
    expect(await ok(["set-policy", M, sc.SG.entityId, "--allow-imported-bank-lines", "true", "--confirm", M])).toMatchObject({ status: "applied", revision: 2, changed: ["allowImportedBankLinesAsVerified"] });
    expect((await ok(["set-policy", M, sc.SG.entityId, "--allow-imported-bank-lines", "true", "--confirm", M])).status).toBe("unchanged");
    // --defaults would turn the flag back off: shown, not applied
    expect((await ok(["set-policy", M, sc.SG.entityId, "--defaults"], {}, 2)).wouldChange).toEqual({ allowImportedBankLinesAsVerified: { from: true, to: false } });
    const a = await rows(sql`select actor_user_id, summary, details from audit_events where action = 'merchant_policy_updated'`);
    expect(a).toEqual([{ actor_user_id: null, summary: "Matching policy revision 2: allowImportedBankLinesAsVerified (operator, admin CLI)", details: { allowImportedBankLinesAsVerified: true } }]);
  });

  it("prints ids, roles and counts only: never an email, a name, a password or a URL", () => {
    expect(outputs.length).toBeGreaterThan(15);
    const all = outputs.map((o) => o.out + o.err).join("\n");
    for (const s of [PASSWORD, "devowner_pw", "postgres://", "@live-a.example", "@provider-a.example", "(fictional)", "First Run"]) expect(all, s).not.toContain(s);
  });
});

describe("the runtime app then works for that merchant (no hand SQL)", () => {
  beforeAll(async () => {
    const orgs = Object.fromEntries((await rows(sql`select slug, id from organizations`)).map((r) => [r.slug, r.id])) as Record<string, string>;
    const users = Object.fromEntries((await rows(sql`select email, id from users`)).map((r) => [r.email, r.id])) as Record<string, string>;
    seed = { orgs: { a: orgs[M], b: orgs[M], providerA: orgs[P], providerB: orgs[P] }, slugs: { a: M, b: M, providerA: P, providerB: P }, users };
  });

  it("Finance signs in through the auth route and lists payments (none yet)", async () => {
    const res = await authPOST(new Request(`${ORIGIN}/api/auth/sign-in/email`, {
      method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": "198.51.100.231" }, body: JSON.stringify({ email: "finance@live-a.example", password: PASSWORD }),
    }));
    expect(res.status).toBe(200);
    const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const list = await paymentsGET(new Request(`${ORIGIN}/api/control/merchant/payments`, { headers: { cookie: `${cookie}; clearline_org=${M}` } }));
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ label: "Your data" });
  });

  it("saves a mapping template (needs the provider link), uploads and confirms the four files, reconciles and exports", async () => {
    const fin = await resolveTenant({ userId: seed.users["finance@live-a.example"], name: "f", email: "finance@live-a.example" }, M);
    const headers = new TextDecoder().decode(sc.sgExportCsv()).split("\n")[0].split(",");
    const tpl = await saveMappingTemplate(fin, { fileType: "provider_export", name: "First provider export", headers, mapping: sc.SG_EXPORT_MAPPING }, liveKey());
    expect(tpl.status).toBe(201);
    live = await seedSgLive(seed, "ZQX-FIRST-RUN");
    expect(live.uploadIds.length).toBe(4);
    const ups = await rows(sql`select status from uploads where org_id = ${seed.orgs.a}`);
    expect(ups.map((u) => u.status)).toEqual(["normalised", "normalised", "normalised", "normalised"]);
    const runs = await rows(sql`select status, matched + with_difference + review + exceptions + unpaid as payments, matched from reconciliation_runs where org_id = ${seed.orgs.a}`);
    expect(runs.length).toBe(1);
    expect(runs[0]).toMatchObject({ status: "changed", payments: sc.SG.orders.length });
    expect(Number(runs[0].matched)).toBeGreaterThan(0);
    const month = (await merchantShell(live.fin)).entities.find((e) => e.id === sc.SG.entityId)!.months[0];
    const pack = await monthEndPack(live.approver, sc.SG.entityId, month);
    expect(pack.manifest).toMatchObject({ label: "Your data", policyRevision: 2, counts: { files: 4 } });
  });
});

describe("the runtime login still cannot set up a merchant", () => {
  it("no organisation, no entity (for any merchant), and a policy change only by an Admin", async () => {
    const as = (email: string, q: ReturnType<typeof sql>) => withTenant({ userId: seed.users[email], orgId: seed.orgs.a }, (tx) => tx.execute(q));
    const refuses = async (p: Promise<unknown>, re: RegExp) => {
      try { await p; } catch (e) { const err = e as Error & { cause?: Error }; expect(`${err.message} ${err.cause?.message ?? ""}`).toMatch(re); return; }
      throw new Error(`expected the database to refuse ${re}`);
    };
    for (const email of ["admin@live-a.example", "finance@live-a.example"]) {
      await refuses(as(email, sql`insert into organizations (slug, name, timezone) values ('forged-org', 'Forged (fictional)', 'UTC')`), /permission denied|row-level security/);
      await refuses(as(email, sql`update organizations set provider_org_id = null where id = ${seed.orgs.a}`), /permission denied/);
      await refuses(as(email, sql`insert into merchant_entities (org_id, id, name, functional_currency, ledger, timezone) values (${seed.orgs.providerA}, 'ENT-FORGED', 'Forged (fictional)', 'SGD', 'none', 'UTC')`), /permission denied/);
      // v1 (0038): not even in its own organisation; entities come from add-entity (owner) only
      await refuses(as(email, sql`insert into merchant_entities (org_id, id, name, functional_currency, ledger, timezone) values (${seed.orgs.a}, 'ENT-OWN', 'Own (fictional)', 'SGD', 'none', 'UTC')`), /permission denied/);
    }
    await refuses(as("finance@live-a.example", sql`update merchant_policy set tolerance_bps = 1000, revision = revision + 1 where org_id = ${seed.orgs.a}`), /only by an Admin/);
    await refuses(withTenant({ userId: seed.users["finance@live-a.example"] }, (tx) => tx.execute(sql`insert into organization_memberships (org_id, user_id, role) values (${seed.orgs.a}, ${seed.users["finance@live-a.example"]}, 'admin')`)), /permission denied|row-level security/);
    expect((await rows(sql`select count(*)::int as n from organizations`))[0].n).toBe(2);
  });
});
