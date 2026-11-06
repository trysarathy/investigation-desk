import { readPrivateFile } from "../src/lib/funding/private";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { emptyFunding, type ImportKind } from "../src/lib/funding/model";
import { importCsv } from "../src/lib/funding/imports";
import { applyFundingEvent } from "../src/lib/funding/review";
import { FundingStore } from "../src/lib/funding/store";
import {
  buildEvidence,
  canonicalJson,
  verifyEvidence,
} from "../src/lib/funding/evidence";
async function main() {
  const args = process.argv.slice(2),
    options = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (
      ![
        "--sample",
        "--data",
        "--advance",
        "--as-of",
        "--out",
        "--verify",
        "--hashes",
      ].includes(key) ||
      options.has(key)
    )
      throw Error("Unknown or duplicate argument");
    if (key === "--sample") {
      options.set(key, "true");
      continue;
    }
    const value = args[++i];
    if (!value || value.startsWith("--")) throw Error("Missing argument value");
    options.set(key, value);
  }
  const get = (key: string) => options.get(key);
  if (get("--verify")) {
    if (options.size !== 2 || !get("--hashes"))
      throw Error(
        "Verify requires only --verify ARCHIVE --hashes TRUSTED_HASHES",
      );
    console.log(
      verifyEvidence(
        await readFile(get("--verify")!),
        JSON.parse(await readFile(get("--hashes")!, "utf8")),
      ),
    );
    return;
  }
  if (
    !get("--advance") ||
    !get("--as-of") ||
    !get("--out") ||
    Boolean(get("--sample")) === Boolean(get("--data")) ||
    get("--hashes")
  )
    throw Error(
      "Usage: --sample|--data STORE --advance ID --as-of UTC_TIME --out NEW_DIRECTORY",
    );
  const at = get("--as-of")!;
  const store = get("--data")
    ? new FundingStore(path.resolve(get("--data")!))
    : undefined;
  let data = emptyFunding();
  if (get("--sample")) {
    for (const kind of ["customers", "advances", "cash"] as ImportKind[])
      data = importCsv(
        data,
        kind,
        await readFile(`fixtures/funding/${kind}.csv`, "utf8"),
        undefined,
        `${kind}.csv`,
        "2026-11-09T10:00:00Z",
      );
    for (const action of ["users", "prepare", "approve"] as const)
      data = applyFundingEvent(data, {
        action,
        at: "2026-11-09T10:00:00Z",
        actor_id: action === "approve" ? "checker" : "maker",
        advance_id: "advance-1",
        reason: "Synthetic review of supplied terms",
        users:
          action === "users"
            ? [
                { id: "maker", name: "Synthetic operator", role: "operator" },
                { id: "checker", name: "Synthetic treasury", role: "approver" },
              ]
            : [],
        import_count: data.imports.length,
        base_revision: data.revision,
      });
    for (const kind of ["payouts", "receipts"] as ImportKind[])
      data = importCsv(
        data,
        kind,
        await readFile(`fixtures/funding/${kind}.csv`, "utf8"),
        undefined,
        `${kind}.csv`,
        at,
      );
  } else {
    await readPrivateFile(path.resolve(get("--data")!));
    data = await store!.load();
  }
  const pack = buildEvidence(
    data,
    get("--advance")!,
    at,
    Boolean(get("--sample")),
  );
  await store?.recordAudit(
    {
      actor: { kind: "local_admin", id: "funding-evidence-cli" },
      action: "export_prepared",
      details: {
        as_of: at,
        advance_id: get("--advance")!,
        ...pack.hashes,
        note: "Evidence generated; delivery not observed.",
      },
    },
    data.revision,
  );
  await mkdir(get("--out")!, { mode: 0o700 });
  await writeFile(path.join(get("--out")!, "evidence.zip"), pack.archive, {
    mode: 0o600,
    flag: "wx",
  });
  await writeFile(
    path.join(get("--out")!, "evidence-hashes.json"),
    canonicalJson(pack.hashes),
    { mode: 0o600, flag: "wx" },
  );
  await store?.recordAudit({
    actor: { kind: "local_admin", id: "funding-evidence-cli" },
    action: "export_files_written",
    details: {
      ...pack.hashes,
      note: "Written locally; no external delivery observed.",
    },
  });
  console.log(canonicalJson(pack.hashes));
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Evidence export failed");
  process.exitCode = 1;
});
