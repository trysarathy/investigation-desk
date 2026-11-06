import { mkdir, readFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { emptyFunding, type ImportKind } from "../src/lib/funding/model";
import { importCsv } from "../src/lib/funding/imports";
import { applyFundingEvent } from "../src/lib/funding/review";
import { hashPassword, writePrivateFile } from "../src/lib/funding/server";
async function main() {
  const args = process.argv.slice(2),
    sample = args.includes("--sample"),
    index = args.indexOf("--dir"),
    dir = args[index + 1],
    usersIndex = args.indexOf("--users"),
    usersFile = args[usersIndex + 1];
  if (index < 0 || !dir || !path.isAbsolute(dir) || (!sample && usersIndex < 0))
    throw Error(
      "Usage: --sample --dir ABSOLUTE_NEW_DIRECTORY, or --users PRIVATE_USERS_JSON --dir ABSOLUTE_NEW_DIRECTORY",
    );
  const password = process.env.CLEARLINE_BOOTSTRAP_PASSWORD;
  if (sample && !password)
    throw Error("Set CLEARLINE_BOOTSTRAP_PASSWORD for synthetic test users.");
  const users = sample
    ? [
        {
          id: "maker",
          email: "maker@example.test",
          name: "Synthetic operator",
          role: "operator",
          password,
        },
        {
          id: "checker",
          email: "checker@example.test",
          name: "Synthetic treasury",
          role: "approver",
          password,
        },
        {
          id: "viewer",
          email: "viewer@example.test",
          name: "Synthetic viewer",
          role: "viewer",
          password,
        },
      ]
    : JSON.parse(await readFile(usersFile, "utf8"));
  if (!Array.isArray(users) || users.length === 0)
    throw Error("Supply a users array.");
  const access = users.map((u) => ({
    id: u.id,
    email: String(u.email).trim().toLowerCase(),
    password_hash: hashPassword(u.password),
  }));
  let data = emptyFunding();
  const at = sample
    ? "2026-11-09T10:00:00Z"
    : new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  if (sample)
    for (const kind of ["customers", "advances", "cash"] as ImportKind[])
      data = importCsv(
        data,
        kind,
        await readFile(`fixtures/funding/${kind}.csv`, "utf8"),
        undefined,
        `${kind}.csv`,
        at,
      );
  data = applyFundingEvent(data, {
    action: "users",
    at,
    actor_id: users[0].id,
    advance_id: "",
    reason: "Local deployment roster configured",
    users: users.map((u) => ({ id: u.id, name: u.name, role: u.role })),
    import_count: data.imports.length,
    base_revision: data.revision,
  });
  await mkdir(dir, { mode: 0o700 });
  await writePrivateFile(path.join(dir, "funding.json"), data);
  await writePrivateFile(path.join(dir, "access.json"), {
    version: 1,
    simulation: sample,
    ...(sample ? { clock: at } : {}),
    users: access,
  });
  if (sample) {
    for (const file of ["payouts.csv", "receipts.csv", "export-settings.json"])
      await copyFile(path.join("fixtures/funding", file), path.join(dir, file));
  }
  console.log(
    `Funding deployment created at ${dir}. ${sample ? "Synthetic users use the supplied bootstrap password." : "Keep the original users file private or securely remove it after provisioning."}`,
  );
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Setup failed");
  process.exitCode = 1;
});
