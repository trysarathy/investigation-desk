/**
 * Clearline Control administration (fictional data only). Uses the schema OWNER connection:
 *   DATABASE_URL=$DATABASE_OWNER_URL npx tsx --conditions=react-server scripts/control/admin.ts <command> ...
 * Commands:
 *   create-org <slug> <name> [sample|empty|live] (rc7 "live": an empty organisation for real uploads, "Your data")
 *   create-user <email> <name>              (password read from CLEARLINE_NEW_PASSWORD; never an argument)
 *   grant <org-slug> <email> <admin|payment_ops|finance|approver|viewer>
 *   revoke <org-slug> <email>
 *   revoke-sessions <email>
 *   seed-demo                               (two fictional organisations and fictional users; passwords from
 *                                            CLEARLINE_SEED_PASSWORD; prints nothing secret)
 *   seed-merchant-cases                     (rc6: fictional provider "Northwind Pay (fictional)" with a white-label
 *                                            theme, two fictional merchants (SG: Cases 1–2, UAE: Case 3) loaded through
 *                                            the ingestion adapters, and fictional users; passwords from
 *                                            CLEARLINE_SEED_PASSWORD; Test mode · illustrative data)
 *   purge-uploads                           (rc7 retention: delete every upload past its delete_after, its file, its
 *                                            validation rows and the data derived only from it; rc8: then delete stored
 *                                            files no upload row names that are older than 60 minutes; prints counts only)
 *   delete-merchant <org-slug> [--confirm <org-slug>]
 *                                           (rc7 phase 3b: delete ONE merchant organisation, every row it holds in every
 *                                            table, its members who belong nowhere else, and its uploaded files. Without
 *                                            --confirm repeating the slug it only prints what would be deleted.
 *                                            Prints counts only)
 *   chain-read-partitions [--months-ahead N] (v1: create the missing monthly partitions of chain_reads from this month
 *                                            to N months ahead, default 24 (#169), max 120; idempotent; prints the count
 *                                            and the last month covered. Run monthly (docs/runbooks/CHAIN_READ_PARTITIONS.md):
 *                                            a read in a month without a partition is refused)
 *   accept-invitation <invitation-id>       (rc6: accept a provider's invitation record: creates the user if needed,
 *                                            password from CLEARLINE_NEW_PASSWORD, name from CLEARLINE_NEW_NAME, and
 *                                            grants the invited merchant role; no email is ever sent)
 *
 * rc8 founder decision 4, a merchant from scratch (src/server/merchant-setup.ts). These read DATABASE_OWNER_URL ONLY
 * (the schema owner login; refused without it or with any other login), print ids, roles and counts only, and are
 * idempotent: the same values again change nothing; overwriting needs --confirm <org-slug> (otherwise a dry run, exit 2).
 *   create-merchant <slug> --name <name> --timezone <IANA>      (a LIVE merchant, "Your data", empty)
 *   create-provider <slug> --name <name> --timezone <IANA>      (a payment provider organisation)
 *   add-entity <org-slug> <entity-id> --name <legal name> --currency SGD|USD|AED --timezone <IANA>
 *              [--utc-offset +08:00|minutes] [--ledger xero|quickbooks|none]
 *                                           (with the default policy: defaultPolicyFor(currency), imported-bank-line flag off)
 *   add-bank-account <org-slug> <entity-id> --name <display name> --currency SGD|USD|AED --last4 <last 4 of the number>
 *              --bank <bank name> [--bic <BIC>]
 *                                           (v1: a bank account of the entity; only the last four characters of the number
 *                                            are stored, never the full number. Prints ids and the currency only)
 *   close-bank-account <org-slug> <bank-account-id> [--confirm <org-slug>]
 *                                           (v1: no new statements to it; its lines stay)
 *   record-rate <org-slug> <BASE/QUOTE> <rate> --as-of <ISO instant> --source <label>
 *                                           (v1 decision 9: one recorded fiat rate, e.g. USD/SGD 1.3500 = SGD per 1 USD;
 *                                            append-only, never edited; calls no rate API. Shows other-currency amounts in
 *                                            the entity's currency and values revaluation proposals; never makes a tie)
 *   set-policy <org-slug> <entity-id> [--defaults] [--tolerance-bps N] [--tolerance-abs-minor N] [--combine larger|smaller]
 *              [--writeoff-threshold-minor N] [--allow-imported-bank-lines true|false] [--confirm <org-slug>]
 *                                           (validated exactly as the Settings page validates it)
 *   link-provider <org-slug> <provider-slug> [--confirm <org-slug>]   (aggregates only; provider invites stay Viewer-only)
 *   add-member <org-slug> <email> <role> [--name <name>] [--confirm <org-slug>]
 *                                           (a new person's password from CLEARLINE_SEED_PASSWORD only; never an argument)
 *   setup-summary <org-slug>                (what the organisation holds: ids and counts)
 *
 * v1 phase 1.1, onboarding (also DATABASE_OWNER_URL only; ids and roles printed, never an email or a token):
 *   invite-admin <org-slug> <email>         (invite the organisation's FIRST admin — Admin of a merchant, Provider Admin
 *                                            of a provider; refused once it has one. The invitation email goes through
 *                                            the email sender: the local outbox, CLEARLINE_EMAIL_OUTBOX_DIR)
 *   grant-platform-operator <email>         (the person may open the platform console, which also needs
 *                                            CLEARLINE_PLATFORM_CONSOLE=1 on the deployment)
 *   revoke-platform-operator <email>        (and signs them out everywhere)
 */
import { sql } from "drizzle-orm";
import { closeDatabase, database } from "../../src/server/db/client";
import { acceptInvitation, createOrganization, createUser, grantMembership, revokeMembership, revokeSessions } from "../../src/server/admin";
import type { AppRole } from "../../src/server/authz";
import { seedMerchantCases } from "../../src/server/merchant-seed";
import { purgeExpiredUploads, sweepOrphanFiles } from "../../src/server/uploads";
import { deleteMerchant, planMerchantDeletion } from "../../src/server/merchant-deletion";
import { monthsAheadArg } from "../../src/server/chain-read-partitions";
import { addBankAccount, addEntity, addMember, closeBankAccount, createMerchant, createProvider, linkProvider, openOwnerDb, recordFiatRate, setPolicy, setupSummary } from "../../src/server/merchant-setup";
import { grantPlatformOperator, inviteFirstAdmin, revokePlatformOperator } from "../../src/server/onboarding/operator";

const DEMO_USERS: { email: string; name: string; org: string; role: AppRole }[] = [
  { email: "ops@lumen.example", name: "Priya Raman (fictional)", org: "lumen-demo", role: "payment_ops" },
  { email: "approver@lumen.example", name: "Daniel Koh (fictional)", org: "lumen-demo", role: "approver" },
  { email: "finance@lumen.example", name: "Mei Lin Tan (fictional)", org: "lumen-demo", role: "finance" },
  { email: "viewer@lumen.example", name: "Arjun Mehta (fictional)", org: "lumen-demo", role: "viewer" },
  { email: "admin@lumen.example", name: "Sara Ong (fictional)", org: "lumen-demo", role: "admin" },
  { email: "ops@harbour.example", name: "Tom Lee (fictional)", org: "harbour-demo", role: "payment_ops" },
  { email: "approver@harbour.example", name: "Nur Aisyah (fictional)", org: "harbour-demo", role: "approver" },
];

/** `--key value` flags and positional arguments (a flag never takes a secret: passwords come from the environment). */
function flags(args: string[]) {
  const pos: string[] = [], f: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith("--")) { pos.push(args[i]); continue; }
    const k = args[i].slice(2);
    if (["defaults"].includes(k)) { f[k] = "true"; continue; }
    if (i + 1 >= args.length) throw new Error(`--${k} needs a value`);
    f[k] = args[++i];
  }
  return { pos, f };
}
const POLICY_FLAGS: Record<string, [string, (v: string) => unknown]> = {
  "tolerance-bps": ["toleranceBps", (v) => (/^\d+$/.test(v) ? Number(v) : v)], "tolerance-abs-minor": ["toleranceAbsMinor", (v) => v], combine: ["toleranceCombine", (v) => v],
  "writeoff-threshold-minor": ["writeoffThresholdMinor", (v) => v], "allow-imported-bank-lines": ["allowImportedBankLinesAsVerified", (v) => (v === "true" ? true : v === "false" ? false : v)],
};
const SETUP = new Set(["create-merchant", "create-provider", "add-entity", "add-bank-account", "close-bank-account", "record-rate", "set-policy", "link-provider", "add-member", "setup-summary",
  "invite-admin", "grant-platform-operator", "revoke-platform-operator"]);

/** rc8 founder decision 4: the owner-only merchant setup commands. Exit 2 for a dry run (nothing changed). */
async function setup(cmd: string, args: string[]) {
  const { pos, f } = flags(args);
  const known = new Set(["name", "timezone", "currency", "utc-offset", "ledger", "confirm", "defaults", "last4", "bank", "bic", "as-of", "source", ...Object.keys(POLICY_FLAGS)]);
  for (const k of Object.keys(f)) if (!known.has(k)) throw new Error(`unknown flag --${k}`);
  const { db, close } = await openOwnerDb(process.env.DATABASE_OWNER_URL);
  try {
    const need = (v: string | undefined, what: string) => { if (!v) throw new Error(`missing ${what}`); return v; };
    let out: { status?: string } & Record<string, unknown>;
    switch (cmd) {
      case "create-merchant": out = await createMerchant(db, { slug: need(pos[0], "<slug>"), name: need(f.name, "--name"), timezone: need(f.timezone, "--timezone") }); break;
      case "create-provider": out = await createProvider(db, { slug: need(pos[0], "<slug>"), name: need(f.name, "--name"), timezone: need(f.timezone, "--timezone") }); break;
      case "add-entity": out = await addEntity(db, { orgSlug: need(pos[0], "<org-slug>"), entityId: need(pos[1], "<entity-id>"), name: need(f.name, "--name"), currency: need(f.currency, "--currency"), timezone: need(f.timezone, "--timezone"), utcOffset: f["utc-offset"], ledger: f.ledger }); break;
      case "add-bank-account": out = await addBankAccount(db, { orgSlug: need(pos[0], "<org-slug>"), entityId: need(pos[1], "<entity-id>"), name: need(f.name, "--name"), currency: need(f.currency, "--currency"), last4: need(f.last4, "--last4"), bankName: need(f.bank, "--bank"), bic: f.bic }); break;
      case "record-rate": out = await recordFiatRate(db, { orgSlug: need(pos[0], "<org-slug>"), pair: need(pos[1], "<BASE/QUOTE>"), rate: need(pos[2], "<rate>"), asOf: need(f["as-of"], "--as-of"), source: need(f.source, "--source") }); break;
      case "close-bank-account": out = await closeBankAccount(db, { orgSlug: need(pos[0], "<org-slug>"), bankAccountId: need(pos[1], "<bank-account-id>"), confirm: f.confirm }); break;
      case "set-policy": {
        const patch = Object.fromEntries(Object.entries(POLICY_FLAGS).filter(([k]) => f[k] !== undefined).map(([k, [field, conv]]) => [field, conv(f[k])]));
        out = await setPolicy(db, { orgSlug: need(pos[0], "<org-slug>"), entityId: need(pos[1], "<entity-id>"), patch, defaults: f.defaults === "true", confirm: f.confirm }); break;
      }
      case "link-provider": out = await linkProvider(db, { orgSlug: need(pos[0], "<org-slug>"), providerSlug: need(pos[1], "<provider-slug>"), confirm: f.confirm }); break;
      case "invite-admin": out = await inviteFirstAdmin(db, { orgSlug: need(pos[0], "<org-slug>"), email: need(pos[1], "<email>") }); break;
      case "grant-platform-operator": out = await grantPlatformOperator(db, need(pos[0], "<email>")); break;
      case "revoke-platform-operator": out = await revokePlatformOperator(db, need(pos[0], "<email>")); break;
      case "add-member": out = await addMember(db, { orgSlug: need(pos[0], "<org-slug>"), email: need(pos[1], "<email>"), role: need(pos[2], "<role>"), name: f.name, password: process.env.CLEARLINE_SEED_PASSWORD, confirm: f.confirm }); break;
      default: out = await setupSummary(db, need(pos[0], "<org-slug>"));
    }
    console.log(JSON.stringify(out));
    if (out.status === "dry_run") { console.log(`Nothing changed. To apply, run again with: --confirm ${pos[0]}`); process.exitCode = 2; }
  } finally { await close(); }
}

async function main() {
  const [cmd, ...a] = process.argv.slice(2);
  if (SETUP.has(cmd)) return setup(cmd, a);
  const db = database();
  switch (cmd) {
    case "create-org": console.log(await createOrganization(db, a[2] === "live" ? { slug: a[0], name: a[1], seed: "empty", dataMode: "live" } : { slug: a[0], name: a[1], seed: (a[2] as "sample" | "empty") ?? "sample" })); break;
    case "create-user": {
      const pw = process.env.CLEARLINE_NEW_PASSWORD;
      if (!pw) throw new Error("set CLEARLINE_NEW_PASSWORD");
      console.log(await createUser(db, { email: a[0], name: a[1], password: pw })); break;
    }
    case "grant": await grantMembership(db, { orgSlug: a[0], email: a[1], role: a[2] as AppRole }); break;
    case "revoke": await revokeMembership(db, { orgSlug: a[0], email: a[1] }); break;
    case "purge-uploads": {
      const now = new Date();
      console.log(JSON.stringify({ ...(await purgeExpiredUploads(db, now)), orphanFiles: await sweepOrphanFiles(db, now) }));
      break;
    }
    case "revoke-sessions": console.log(await revokeSessions(db, a[0]), "sessions revoked"); break;
    case "seed-demo": {
      const pw = process.env.CLEARLINE_SEED_PASSWORD;
      if (!pw || pw.length < 12) throw new Error("set CLEARLINE_SEED_PASSWORD (≥ 12 chars) for the fictional demo users");
      await createOrganization(db, { slug: "lumen-demo", name: "Lumen Cross-Border Payments (fictional)", seed: "sample" });
      await createOrganization(db, { slug: "harbour-demo", name: "Harbour Remit (fictional)", seed: "sample" });
      for (const u of DEMO_USERS) {
        await createUser(db, { email: u.email, name: u.name, password: pw }).catch((e) => { if (!/duplicate|unique/i.test(String(e))) throw e; });
        await grantMembership(db, { orgSlug: u.org, email: u.email, role: u.role });
      }
      console.log(`seeded 2 fictional organisations and ${DEMO_USERS.length} fictional users`); break;
    }
    case "seed-merchant-cases": {
      const pw = process.env.CLEARLINE_SEED_PASSWORD;
      if (!pw || pw.length < 12) throw new Error("set CLEARLINE_SEED_PASSWORD (≥ 12 chars) for the fictional merchant users");
      const r = await seedMerchantCases(db, { password: pw });
      console.log(`${r.label}: seeded a fictional provider, 2 fictional merchants (${Object.keys(r.written).join(", ")}) and ${Object.keys(r.users).length} fictional users`); break;
    }
    case "delete-merchant": {
      const i = a.indexOf("--confirm");
      const confirm = i >= 0 ? a[i + 1] : undefined;
      if (!confirm) {
        const plan = await planMerchantDeletion(db, a[0]);
        console.log(JSON.stringify({ wouldDelete: { tables: plan.tables, users: plan.users, files: plan.files } }));
        console.log(`Nothing deleted. To delete this merchant and everything it holds, run again with: --confirm ${a[0]}`);
        process.exitCode = 2;
        break;
      }
      console.log(JSON.stringify({ deleted: await deleteMerchant(db, a[0], confirm) }));
      break;
    }
    case "chain-read-partitions": {
      const ahead = monthsAheadArg(a);
      const r = await db.execute(sql`select chain_reads_ensure_partitions(current_date, (current_date + make_interval(months => ${ahead}))::date) as created,
        (select max(c.relname) from pg_inherits i join pg_class c on c.oid = i.inhrelid where i.inhparent = 'chain_reads'::regclass) as last`);
      console.log(JSON.stringify({ created: r.rows[0].created, lastPartition: r.rows[0].last })); break;
    }
    case "accept-invitation": {
      const r = await acceptInvitation(db, a[0], { password: process.env.CLEARLINE_NEW_PASSWORD, name: process.env.CLEARLINE_NEW_NAME });
      console.log(`accepted: ${r.email} is now ${r.role} at ${r.orgSlug}`); break;
    }
    default: throw new Error(`unknown command ${cmd}`);
  }
  await closeDatabase();
}
main().catch(async (e) => { console.error(e instanceof Error ? e.message : e); await closeDatabase(); process.exit(1); });
