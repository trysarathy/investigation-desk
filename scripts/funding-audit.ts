import { readPrivateFile } from "../src/lib/funding/private";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { FundingStore } from "../src/lib/funding/store";
async function main() {
  const args = process.argv.slice(2),
    opts = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (
      !["--data", "--anchor-out", "--verify-anchor"].includes(args[i]) ||
      !args[i + 1] ||
      opts.has(args[i])
    )
      throw Error(
        "Usage: --data PRIVATE_STORE [--anchor-out NEW_FILE | --verify-anchor TRUSTED_FILE]",
      );
    opts.set(args[i], args[i + 1]);
  }
  if (
    !opts.get("--data") ||
    (opts.has("--anchor-out") && opts.has("--verify-anchor"))
  )
    throw Error("Choose one private store and at most one anchor action.");
  await readPrivateFile(path.resolve(opts.get("--data")!));
  const store = new FundingStore(path.resolve(opts.get("--data")!));
  const expected = opts.has("--verify-anchor")
    ? JSON.parse(await readFile(opts.get("--verify-anchor")!, "utf8"))
    : undefined;
  const result = await store.inspectAudit(expected);
  if (opts.has("--anchor-out"))
    await writeFile(
      opts.get("--anchor-out")!,
      JSON.stringify(result.anchor, null, 2) + "\n",
      { mode: 0o600, flag: "wx" },
    );
  console.log(
    JSON.stringify(
      {
        verified_entries: result.entries.length,
        anchor: result.anchor,
        note: expected
          ? "Trusted anchor is retained in this chain."
          : "No external anchor supplied; complete log replacement is not excluded.",
      },
      null,
      2,
    ),
  );
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Audit verification failed");
  process.exitCode = 1;
});
