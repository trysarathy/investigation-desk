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
 *   accept-invitation <invitation-id>       (rc6: accept a provider's invitation record: creates the user if needed,
 *                                            password from CLEARLINE_NEW_PASSWORD, name from CLEARLINE_NEW_NAME, and
 *                                            grants the invited merchant role; no email is ever sent)
 */
import { closeDatabase, database } from "../../src/server/db/client";
import { acceptInvitation, createOrganization, createUser, grantMembership, revokeMembership, revokeSessions } from "../../src/server/admin";
import type { AppRole } from "../../src/server/authz";
import { seedMerchantCases } from "../../src/server/merchant-seed";
import { purgeExpiredUploads, sweepOrphanFiles } from "../../src/server/uploads";
import { deleteMerchant, planMerchantDeletion } from "../../src/server/merchant-deletion";

const DEMO_USERS: { email: string; name: string; org: string; role: AppRole }[] = [
  { email: "ops@lumen.example", name: "Priya Raman (fictional)", org: "lumen-demo", role: "payment_ops" },
  { email: "approver@lumen.example", name: "Daniel Koh (fictional)", org: "lumen-demo", role: "approver" },
  { email: "finance@lumen.example", name: "Mei Lin Tan (fictional)", org: "lumen-demo", role: "finance" },
  { email: "viewer@lumen.example", name: "Arjun Mehta (fictional)", org: "lumen-demo", role: "viewer" },
  { email: "admin@lumen.example", name: "Sara Ong (fictional)", org: "lumen-demo", role: "admin" },
  { email: "ops@harbour.example", name: "Tom Lee (fictional)", org: "harbour-demo", role: "payment_ops" },
  { email: "approver@harbour.example", name: "Nur Aisyah (fictional)", org: "harbour-demo", role: "approver" },
];

async function main() {
  const [cmd, ...a] = process.argv.slice(2);
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
    case "accept-invitation": {
      const r = await acceptInvitation(db, a[0], { password: process.env.CLEARLINE_NEW_PASSWORD, name: process.env.CLEARLINE_NEW_NAME });
      console.log(`accepted: ${r.email} is now ${r.role} at ${r.orgSlug}`); break;
    }
    default: throw new Error(`unknown command ${cmd}`);
  }
  await closeDatabase();
}
main().catch(async (e) => { console.error(e instanceof Error ? e.message : e); await closeDatabase(); process.exit(1); });
