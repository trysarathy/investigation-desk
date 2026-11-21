import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

/**
 * The axe-core script that every Clearline browser spec injects (with page.evaluate: the nonce CSP blocks an
 * injected inline <script>).
 *
 * axe-core is a pinned devDependency, so it is always installed by `npm ci`. CLEARLINE_AXE_PATH or
 * QA_AXE_PATH still override it (to try another axe version). If neither the override nor the package can be
 * found, this throws: an accessibility test must fail loudly rather than silently skip its axe check, which
 * is what happened in CI before axe-core was pinned (run 43730455949).
 */
export function axeSource(): string {
  const overrides = [process.env.CLEARLINE_AXE_PATH, process.env.QA_AXE_PATH].filter((p): p is string => !!p);
  for (const p of overrides) {
    if (!existsSync(p)) throw new Error(`axe override ${p} does not exist`);
    return readFileSync(p, "utf8");
  }
  const req = createRequire(join(process.cwd(), "package.json"));
  return readFileSync(req.resolve("axe-core/axe.min.js"), "utf8");
}
