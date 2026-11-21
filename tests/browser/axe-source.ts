import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

/** Oldest axe-core accepted: 4.14 is the pinned devDependency and the first to run label-content-name-mismatch. */
const MIN_AXE = [4, 14] as const;

/**
 * The axe-core script that every Clearline browser spec injects (with page.evaluate: the nonce CSP blocks an
 * injected inline <script>).
 *
 * axe-core is a pinned devDependency, so `npm ci` always installs it. CLEARLINE_AXE_PATH, else QA_AXE_PATH,
 * overrides it. Only the first override that is set is used: if CLEARLINE_AXE_PATH is set but missing, this throws
 * even when QA_AXE_PATH is valid.
 *
 * It throws instead of returning nothing, so an accessibility test fails loudly rather than silently skipping its
 * axe check (what happened in CI before axe-core was pinned: run 43730455949). It also refuses an empty file, a file
 * without the axe banner, or an axe older than MIN_AXE, so a stub or a stale copy cannot make the tests pass
 * vacuously.
 */
export function axeSource(): string {
  const override = process.env.CLEARLINE_AXE_PATH || process.env.QA_AXE_PATH;
  let path: string;
  if (override) {
    if (!existsSync(override)) throw new Error(`axe override ${override} does not exist`);
    path = override;
  } else {
    path = createRequire(join(process.cwd(), "package.json")).resolve("axe-core/axe.min.js");
  }
  const src = readFileSync(path, "utf8");
  const m = /^\/\*! axe v(\d+)\.(\d+)\.(\d+)/.exec(src);
  if (!m) throw new Error(`${path} is not an axe-core build (no "/*! axe vX.Y.Z" banner)`);
  const [major, minor] = [Number(m[1]), Number(m[2])];
  if (major < MIN_AXE[0] || (major === MIN_AXE[0] && minor < MIN_AXE[1])) {
    throw new Error(`${path} is axe ${m[1]}.${m[2]}.${m[3]}; at least ${MIN_AXE.join(".")} is required`);
  }
  return src;
}
