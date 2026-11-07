import { constants } from "node:fs";
import { open, lstat, realpath, rename, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
export async function assertPrivateDirectory(dir: string) {
  const resolved = path.resolve(dir),
    stat = await lstat(resolved);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    (process.getuid && stat.uid !== process.getuid()) ||
    (await realpath(resolved)) !== resolved
  )
    throw Error(
      "Use an owned private directory (0700) without symbolic links.",
    );
}
async function regular(file: string, allowMissing = false) {
  try {
    const st = await lstat(file);
    if (
      !st.isFile() ||
      st.isSymbolicLink() ||
      st.nlink !== 1 ||
      (process.getuid && st.uid !== process.getuid()) ||
      (st.mode & 0o077) !== 0
    )
      throw Error("Use an owned private regular file (0600), without links.");
  } catch (e) {
    if (allowMissing && (e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
}
export async function readPrivateFile(file: string) {
  await assertPrivateDirectory(path.dirname(file));
  await regular(file);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = await handle.stat();
    if (
      !st.isFile() ||
      st.size > 64 * 1024 * 1024 ||
      st.nlink !== 1 ||
      (st.mode & 0o077) !== 0
    )
      throw Error("Private file is unsafe or exceeds 64 MiB.");
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}
export async function writePrivateAtomic(file: string, body: string) {
  await assertPrivateDirectory(path.dirname(file));
  await regular(file, true);
  if (Buffer.byteLength(body) > 64 * 1024 * 1024)
    throw Error(
      "Private store exceeds 64 MiB; archive with an approved retention process.",
    );
  const temp = `${file}.${randomBytes(16).toString("hex")}.tmp`;
  try {
    const handle = await open(
      temp,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(body, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, file);
  } catch (e) {
    await rm(temp, { force: true });
    throw e;
  }
}

export function assertDeploymentLocation(dir: string) {
  const resolved = path.resolve(dir),
    root = path.resolve(process.cwd());
  if (
    !path.isAbsolute(dir) ||
    resolved === root ||
    resolved.startsWith(root + path.sep)
  )
    throw Error(
      "Keep the private funding directory outside the application repository and public assets.",
    );
  return resolved;
}
