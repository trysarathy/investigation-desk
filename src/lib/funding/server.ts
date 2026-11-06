import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { FundingStore } from "./store";
import { instant } from "./model";
import { writeAtomic, withLock } from "../lock";
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
  return value;
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
export function verifyPassword(password: string, hash: string) {
  if (typeof password !== "string" || password.length > 256) return false;
  const match = /^scrypt\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(hash);
  if (!match) return false;
  return timingSafeEqual(
    scryptSync(password, match[1], 32),
    Buffer.from(match[2], "hex"),
  );
}
export async function fundingConfig(): Promise<FundingConfig> {
  const c = JSON.parse(
    await readFile(path.join(fundingDirectory(), "access.json"), "utf8"),
  ) as FundingConfig;
  if (
    !c ||
    c.version !== 1 ||
    typeof c.simulation !== "boolean" ||
    !Array.isArray(c.users) ||
    c.users.length < 1 ||
    c.users.length > 100 ||
    c.users.some(
      (u) =>
        !u ||
        typeof u.id !== "string" ||
        typeof u.email !== "string" ||
        !/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(u.password_hash),
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
  const config = await fundingConfig();
  const normalized =
    typeof email === "string" ? email.trim().toLowerCase() : "";
  if (normalized.length > 200) throw Error("Email or password is incorrect.");
  const now = Date.now();
  for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
  if (attempts.size >= 1000 && !attempts.has(normalized))
    throw Error("Sign-in is busy. Try later.");
  const previous = attempts.get(normalized);
  if (previous && previous.count >= 5)
    throw Error("Too many sign-in attempts. Try again in 15 minutes.");
  const user = config.users.find((u) => u.email === normalized);
  const valid = verifyPassword(
    password,
    user?.password_hash ??
      "scrypt$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000",
  );
  if (!user || !valid) {
    attempts.set(normalized, {
      count: (previous?.count ?? 0) + 1,
      until: previous?.until ?? now + 900000,
    });
    throw Error("Email or password is incorrect.");
  }
  const data = await fundingStore().load();
  if (!data.users.some((u) => u.id === user.id))
    throw Error("This user is not on the current funding roster.");
  attempts.delete(normalized);
  for (const [k, v] of sessions) if (v.expires < now) sessions.delete(k);
  if (sessions.size >= 1000)
    throw Error("Too many sessions. Sign out another session.");
  const token = randomBytes(32).toString("hex"),
    csrf = randomBytes(24).toString("hex");
  sessions.set(key(token), {
    credential: user.password_hash,
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
  if (!session || session.expires < Date.now())
    throw new AuthRequired("Sign in to the funding desk.");
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
export function assertOrigin(request: Request) {
  const origin = process.env.CLEARLINE_ORIGIN;
  if (
    !origin ||
    new URL(origin).origin !== origin ||
    request.headers.get("origin") !== origin
  )
    throw Error("Open the desk at its configured address before submitting.");
}
export async function readBody(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw Error("Send a JSON request.");
  const reader = request.body?.getReader();
  if (!reader) throw Error("A request body is required.");
  let length = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 2_100_000) {
      await reader.cancel();
      throw Error("This request is too large. Split the input file.");
    }
    chunks.push(value);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Send a JSON object.");
  return value as Record<string, unknown>;
}
export async function advanceClock(at: string) {
  instant(at);
  await withLock("funding-clock", async () => {
    const config = await fundingConfig();
    if (!config.simulation) throw Error("The server clock cannot be changed.");
    if (instant(at) < instant(config.clock!))
      throw Error("The simulation clock only moves forward.");
    config.clock = at;
    await writeAtomic(
      path.join(fundingDirectory(), "access.json"),
      JSON.stringify(config),
    );
  });
}
export async function privateSettings() {
  return JSON.parse(
    await readFile(
      path.join(fundingDirectory(), "export-settings.json"),
      "utf8",
    ),
  );
}
export async function writePrivateFile(file: string, value: unknown) {
  await writeFile(file, JSON.stringify(value), { mode: 0o600, flag: "wx" });
}
