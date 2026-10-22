import {
  database,
  getDocument,
  putDocument,
  audit,
  workspaceId,
  atomic,
} from "./store";
export function retentionDays() {
  return getDocument<{ days: number }>("retention", "current")?.days ?? 90;
}
export function setRetention(days: number, actor: string) {
  if (![7, 30, 90].includes(days)) throw Error("Choose 7, 30 or 90 days");
  putDocument("retention", "current", { days });
  audit("retention.changed", String(days), actor);
}
/** Removes expired evidence documents. Audit metadata is kept separately; backups require operator deletion. */
export function sweepRetention(now = Date.now(), actor = "system") {
  return atomic(() => {
    const cutoff = now - retentionDays() * 86400000;
    const rows = database()
      .prepare(
        "SELECT kind,id,body FROM documents WHERE workspace=? AND kind IN ('case','regression','scan','alert','slack-request','intelligence-contribution')",
      )
      .all(workspaceId()) as { kind: string; id: string; body: string }[];
    let deleted = 0;
    for (const row of rows) {
      const body = JSON.parse(row.body);
      const timestamp =
        body.createdAt ?? body.startedAt ?? body.label?.at ?? body.day;
      const expired = timestamp && Date.parse(timestamp) < cutoff;
      // Slack replay responses hold no evidence but have no timestamp: discard at each sweep.
      if (expired || row.kind === "slack-request") {
        database()
          .prepare(
            "DELETE FROM documents WHERE workspace=? AND kind=? AND id=?",
          )
          .run(workspaceId(), row.kind, row.id);
        deleted++;
      }
    }
    audit("retention.swept", String(deleted), actor);
    return {
      deleted,
      cutoff: new Date(cutoff).toISOString(),
      remainingScope:
        "Legacy CSV, bulk files, raw cache and external backups require operator lifecycle deletion. Do not claim complete erasure.",
    };
  });
}

/** Local-file migration path: exactly the known legacy stores, never arbitrary paths. */
export async function sweepLegacyFiles(root: string, cutoff: number) {
  const { readFile, readdir, unlink, writeFile, rename } =
    await import("node:fs/promises");
  const path = await import("node:path");
  let deletedFiles = 0;
  const old = (at: unknown) =>
    typeof at === "string" &&
    Number.isFinite(Date.parse(at)) &&
    Date.parse(at) < cutoff;
  for (const dir of ["raw", "cache", "bulk"]) {
    const folder = path.join(root, dir);
    let entries: string[];
    try {
      entries = await readdir(folder);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!/^[a-f0-9-]+\.json$/.test(name)) continue;
      const file = path.join(folder, name);
      const j = JSON.parse(await readFile(file, "utf8"));
      const at = j.fetchedAt ?? j.raw?.fetchedAt ?? j.createdAt;
      if (old(at)) {
        await unlink(file);
        deletedFiles++;
      }
    }
  }
  for (const name of ["workspace.json", "cases.json"]) {
    const file = path.join(root, name);
    let j;
    try {
      j = JSON.parse(await readFile(file, "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw e;
    }
    if (name === "cases.json")
      j = j.filter((c: { createdAt: string }) => !old(c.createdAt));
    else {
      for (const key of ["fileA", "fileB"])
        if (old(j[key]?.upload?.uploadedAt)) delete j[key];
      j.history = (j.history ?? []).filter(
        (h: { uploadedAt: string }) => !old(h.uploadedAt),
      );
    }
    await writeFile(file + ".retention.tmp", JSON.stringify(j));
    await rename(file + ".retention.tmp", file);
  }
  return { deletedFiles };
}
