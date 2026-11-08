import {
  randomBytes,
  scryptSync,
  scrypt,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { FundingStore } from "./store";
import { instant } from "./model";
import { withLock } from "../lock";
import {
  readPrivateFile,
  writePrivateAtomic,
  assertPrivateDirectory,
  assertDeploymentLocation,
} from "./private";
export interface LoginUser {
  id: string;
  email: string;
  password_hash: string;
}
export interface FundingConfig {
  version: 1;
  simulation: boolean;
  clock?: string;
  users: LoginUser[];
}
export class AuthRequired extends Error {}
interface Session {
  credential: string;
  deployment: string;
  user_id: string;
  csrf: string;
  expires: number;
}
const sessions = new Map<string, Session>(),
  attempts = new Map<string, { count: number; until: number }>();
export const fundingDirectory = () => {
  const value = process.env.CLEARLINE_FUNDING_DIR;
  if (!value || !path.isAbsolute(value))
    throw Error("Set an absolute private CLEARLINE_FUNDING_DIR.");
  return assertDeploymentLocation(value);
};
export const fundingStore = () =>
  new FundingStore(path.join(fundingDirectory(), "funding.json"));
export function hashPassword(password: string) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 256
  )
    throw Error("Use a password between 12 and 256 characters.");
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(password, salt, 32).toString("hex")}`;
}
const HASH_PATTERN = /^scrypt\$([a-f0-9]{32})\$([a-f0-9]{64})$/;
const MAX_VERIFICATIONS = 4;
let activeVerifications = 0;
let globalAttempts = { count: 0, until: 0 };

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  if (typeof password !== "string" || password.length > 256) return false;
  const match = typeof hash === "string" ? HASH_PATTERN.exec(hash) : null;
  if (!match) return false;
  if (activeVerifications >= MAX_VERIFICATIONS)
    throw Error("Sign-in is busy. Try later.");
  activeVerifications++;
  try {
    const derived = await new Promise<Buffer>((resolve, reject) =>
      scrypt(
        password,
        match[1],
        32,
        { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 },
        (error, key) => (error ? reject(error) : resolve(key)),
      ),
    );
    return timingSafeEqual(derived, Buffer.from(match[2], "hex"));
  } finally {
    activeVerifications--;
  }
}
const plain = (value: unknown, limit: number): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= limit &&
  value.trim() === value &&
  !/[\u0000-\u001f\u007f]/.test(value);
const keys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
export async function fundingConfig(): Promise<FundingConfig> {
  let c: FundingConfig;
  try {
    const text = await readPrivateFile(
      path.join(fundingDirectory(), "access.json"),
    );
    if (Buffer.byteLength(text) > 100_000) throw Error();
    c = JSON.parse(text) as FundingConfig;
  } catch {
    throw Error("Private access configuration cannot be read.");
  }
  if (
    !c ||
    typeof c !== "object" ||
    Array.isArray(c) ||
    !keys(c as unknown as Record<string, unknown>, [
      "version",
      "simulation",
      "clock",
      "users",
    ]) ||
    c.version !== 1 ||
    typeof c.simulation !== "boolean" ||
    (!c.simulation && Object.hasOwn(c, "clock")) ||
    !Array.isArray(c.users) ||
    c.users.length < 1 ||
    c.users.length > 100 ||
    c.users.some(
      (u) =>
        !u ||
        typeof u !== "object" ||
        Array.isArray(u) ||
        !keys(u as unknown as Record<string, unknown>, [
          "id",
          "email",
          "password_hash",
        ]) ||
        !plain(u.id, 100) ||
        !plain(u.email, 200) ||
        u.email !== u.email.toLowerCase() ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email) ||
        typeof u.password_hash !== "string" ||
        !HASH_PATTERN.test(u.password_hash),
    ) ||
    new Set(c.users.map((u) => u.id)).size !== c.users.length ||
    new Set(c.users.map((u) => u.email)).size !== c.users.length
  )
    throw Error("Invalid private access configuration.");
  if (c.simulation) instant(c.clock ?? "");
  return c;
}
export const fundingNow = (config: FundingConfig) =>
  config.simulation
    ? config.clock!
    : new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const key = (token: string) => createHash("sha256").update(token).digest("hex");
export async function login(email: string, password: string) {
  const normalized =
    typeof email === "string" ? email.trim().toLowerCase() : "";
  if (
    !plain(normalized, 200) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ||
    typeof password !== "string" ||
    password.length > 256
  )
    throw Error("Email or password is incorrect.");
  const now = Date.now();
  if (globalAttempts.until <= now)
    globalAttempts = { count: 0, until: now + 60_000 };
  if (globalAttempts.count >= 100) throw Error("Sign-in is busy. Try later.");
  globalAttempts.count++;
  const attemptKey = key(`${fundingDirectory()}\0${normalized}`);
  for (const [k, v] of attempts) if (v.until <= now) attempts.delete(k);
  if (attempts.size >= 1000 && !attempts.has(attemptKey))
    throw Error("Sign-in is busy. Try later.");
  const previous = attempts.get(attemptKey);
  if (previous && previous.count >= 5)
    throw Error("Too many sign-in attempts. Try again in 15 minutes.");
  // Charge before the asynchronous hash so simultaneous guesses share the same limit.
  attempts.set(attemptKey, {
    count: (previous?.count ?? 0) + 1,
    until: previous?.until ?? now + 900_000,
  });
  const config = await fundingConfig();
  const user = config.users.find((u) => u.email === normalized);
  const valid = await verifyPassword(
    password,
    user?.password_hash ??
      "scrypt$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000",
  );
  if (!user || !valid) throw Error("Email or password is incorrect.");
  const data = await fundingStore().load();
  if (!data.users.some((u) => u.id === user.id))
    throw Error("This user is not on the current funding roster.");
  attempts.delete(attemptKey);
  for (const [k, v] of sessions) if (v.expires < now) sessions.delete(k);
  if (sessions.size >= 1000)
    throw Error("Too many sessions. Sign out another session.");
  const token = randomBytes(32).toString("hex"),
    csrf = randomBytes(24).toString("hex");
  sessions.set(key(token), {
    credential: user.password_hash,
    deployment: fundingDirectory(),
    user_id: user.id,
    csrf,
    expires: now + 8 * 3600000,
  });
  return { token, csrf };
}
export function cookieToken(request: Request) {
  return (
    /(?:^|;\s*)clearline_session=([a-f0-9]{64})(?:;|$)/.exec(
      request.headers.get("cookie") ?? "",
    )?.[1] ?? ""
  );
}
export async function authenticate(request: Request) {
  const token = cookieToken(request),
    session = sessions.get(key(token));
  if (
    !session ||
    session.expires <= Date.now() ||
    session.deployment !== fundingDirectory()
  ) {
    sessions.delete(key(token));
    throw new AuthRequired("Sign in to the funding desk.");
  }
  const config = await fundingConfig();
  if (
    !config.users.some(
      (u) => u.id === session.user_id && u.password_hash === session.credential,
    )
  )
    throw new AuthRequired("Sign in to the funding desk.");
  const data = await fundingStore().load(),
    user = data.users.find((u) => u.id === session.user_id);
  if (!user) throw new AuthRequired("Sign in to the funding desk.");
  return { session, user, data, config };
}
export function logout(request: Request) {
  sessions.delete(key(cookieToken(request)));
}
// Codespaces' authenticated port-forwarding proxy can replace an otherwise
// correct browser Origin with http://localhost:PORT before Next receives it.
// Permit only that exact translation, and only when the host, referer,
// Fetch Metadata, Codespace identity and configured HTTPS URL all agree.
// This does not relax normal production-origin validation.
function codespacesForwardedOrigin(request: Request, configured: URL): boolean {
  const name = process.env.CODESPACE_NAME;
  const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  if (!name || domain !== "app.github.dev" || configured.protocol !== "https:")
    return false;
  const prefix = name + "-";
  const suffix = "." + domain;
  if (
    !configured.hostname.startsWith(prefix) ||
    !configured.hostname.endsWith(suffix) ||
    configured.port ||
    request.headers.get("host") !== configured.host ||
    request.headers.get("sec-fetch-site") !== "same-origin"
  ) return false;
  const port = configured.hostname.slice(prefix.length, -suffix.length);
  if (!/^[1-9][0-9]{0,4}$/.test(port) || Number(port) > 65535) return false;
  if (
    ![`http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(
      request.headers.get("origin") ?? "",
    )
  ) return false;
  try {
    const referer = new URL(request.headers.get("referer") ?? "");
    return referer.origin === configured.origin && referer.pathname === "/funding";
  } catch {
    return false;
  }
}
export function assertOrigin(request: Request) {
  const origin = process.env.CLEARLINE_ORIGIN;
  let url: URL;
  try {
    url = new URL(origin ?? "");
  } catch {
    throw Error("Configure the desk's HTTPS origin.");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    !origin ||
    url.origin !== origin ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    (request.headers.get("origin") !== origin &&
      !codespacesForwardedOrigin(request, url)) ||
    (request.headers.get("sec-fetch-site") &&
      !["same-origin", "none"].includes(request.headers.get("sec-fetch-site")!))
  )
    throw Error(
      "Open the desk at its configured HTTPS address before submitting.",
    );
}
export async function readBody(request: Request) {
  const type = request.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();
  if (type !== "application/json") throw Error("Send a JSON request.");
  const declared = request.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) > 2_100_000)
  ) {
    await request.body?.cancel();
    throw Error("This request is too large. Split the input file.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw Error("A request body is required.");
  let length = 0,
    complete = false;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        break;
      }
      length += value.length;
      if (length > 2_100_000)
        throw Error("This request is too large. Split the input file.");
      chunks.push(value);
    }
    let value: unknown;
    try {
      value = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
      );
    } catch {
      throw Error("Send valid UTF-8 JSON.");
    }
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error("Send a JSON object.");
    return value as Record<string, unknown>;
  } finally {
    if (!complete) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
export async function advanceClock(
  at: string,
  actor: { kind: "user" | "local_admin" | "system"; id: string },
) {
  instant(at);
  await withLock("funding-clock", async () => {
    const config = await fundingConfig();
    if (!config.simulation) throw Error("The server clock cannot be changed.");
    if (instant(at) < instant(config.clock!))
      throw Error("The simulation clock only moves forward.");
    const details = { from: config.clock!, to: at };
    await fundingStore().recordAudit({
      actor,
      action: "clock_requested",
      details,
    });
    config.clock = at;
    await writePrivateAtomic(
      path.join(fundingDirectory(), "access.json"),
      JSON.stringify(config),
    );
    await fundingStore().recordAudit({
      actor,
      action: "clock_recorded",
      details,
    });
  });
}
export async function privateSettings() {
  return JSON.parse(
    await readPrivateFile(
      path.join(fundingDirectory(), "export-settings.json"),
    ),
  );
}
export async function writePrivateFile(file: string, value: unknown) {
  await assertPrivateDirectory(path.dirname(file));
  await writeFile(file, JSON.stringify(value), { mode: 0o600, flag: "wx" });
}
