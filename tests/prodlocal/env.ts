/**
 * The prod-local proof (docs/ops/PROD_LOCAL.md): settings of the stack scripts/prodlocal/run.sh started. Secrets are
 * read from .prodlocal/secrets.env (generated on this machine, local-only, never committed or printed). Every person
 * and value the suite creates is fictional.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const STATE = process.env.PRODLOCAL_DIR ?? path.resolve(__dirname, "../../.prodlocal");
function secrets(): Record<string, string> {
  try {
    return Object.fromEntries(readFileSync(path.join(STATE, "secrets.env"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  } catch {
    throw new Error("BLOCKED: .prodlocal/secrets.env not found; start the stack first: scripts/prodlocal/run.sh up");
  }
}
const s = secrets();
const PG = Number(process.env.PRODLOCAL_PG_PORT ?? 4441);
const APP = Number(process.env.PRODLOCAL_APP_PORT ?? 4440);
export const PRODLOCAL = {
  state: STATE,
  origin: `http://127.0.0.1:${APP}`,
  ownerUrl: `postgres://clearline_owner:${s.OWNER_PW}@127.0.0.1:${PG}/clearline_prodlocal`,
  authSecret: s.BETTER_AUTH_SECRET,
  /** Fictional people's password and authenticator secret (test-only). */
  password: "fictional-prodlocal-pass-01",
  totpSecret: "fictional-prodlocal-totp-0000001",
  org: "harbourline-prodlocal",
  entity: "ENT-SG-SYN",
  month: "2026-11",
  people: {
    admin: "admin@harbourline-prodlocal.example",
    approver: "approver@harbourline-prodlocal.example",
    finance: "finance@harbourline-prodlocal.example",
    ops: "ops@harbourline-prodlocal.example",
  },
} as const;
