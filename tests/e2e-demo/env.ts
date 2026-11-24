/**
 * The demo browser suite's settings: the port of its demo server and the local demo state (.demo/state.json, written
 * by `npm run demo`). The shared demo password is fictional and local. Demo · fictional data.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const PORT = Number(process.env.CLEARLINE_DEMO_E2E_PORT ?? 3402);
const ROOT = path.resolve(__dirname, "../..");
export const STATE_FILE = path.join(ROOT, ".demo/state.json");

export const DEMO_E2E = {
  port: PORT,
  origin: `http://127.0.0.1:${PORT}`,
  root: ROOT,
} as const;

/** The shared demo password (read when a test needs it: the web server writes the state file before tests start). */
export function demoPassword(): string {
  if (!existsSync(STATE_FILE)) throw new Error("no .demo/state.json: the demo web server should have created it (npm run demo -- --no-start)");
  return (JSON.parse(readFileSync(STATE_FILE, "utf8")) as { passwords: { demo: string } }).passwords.demo;
}

export const DEMO_USERS = {
  finance: "finance@northwind.demo",
  approver: "approver@northwind.demo",
  viewer: "viewer@northwind.demo",
  admin: "admin@northwind.demo",
  ops: "ops@providerp.demo",
} as const;
export const DEMO_LABEL = "Demo · fictional data";
