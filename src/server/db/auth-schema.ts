/**
 * v1 phase 1.2: sign-in security tables (drizzle/0050_mfa_passkeys.sql, drizzle/0051_email_tokens_rate_limits.sql).
 * `twoFactors` is Better Auth's two-factor plugin table (model "twoFactor", plural names); the rest are Clearline's.
 */
import { bigint, boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations, users } from "./schema";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** TOTP secret and recovery codes, both encrypted by Better Auth with the server secret. */
export const twoFactors = pgTable("two_factors", {
  id: text("id").primaryKey(),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  verified: boolean("verified").default(true),
  failedVerificationCount: integer("failed_verification_count").default(0),
  lockedUntil: ts("locked_until"),
});

/** WebAuthn credentials: public keys only (src/server/webauthn.ts). */
export const passkeys = pgTable("passkeys", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  credentialId: text("credential_id").notNull().unique(),
  publicKeySpki: text("public_key_spki").notNull(),
  alg: integer("alg").notNull(),
  signCount: bigint("sign_count", { mode: "number" }).notNull().default(0),
  transports: text("transports"),
  name: text("name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastUsedAt: ts("last_used_at"),
});

export const orgSecuritySettings = pgTable("org_security_settings", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id),
  requireMfaAll: boolean("require_mfa_all").notNull().default(false),
  updatedBy: text("updated_by").notNull().references(() => users.id),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Single-use e-mail verification tokens; only the SHA-256 of a token is stored. */
export const authTokens = pgTable("auth_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  purpose: text("purpose").notNull(),
  tokenSha256: text("token_sha256").notNull().unique(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** The local stand-in e-mail sender's outbox. The web app can only insert. */
export const emailOutbox = pgTable("email_outbox", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  toAddress: text("to_address").notNull(),
  subject: text("subject").notNull(),
  textBody: text("text_body").notNull(),
  htmlBody: text("html_body"),
  /** v1 wave 1 (drizzle/0068): what the message is for, e.g. "invitation". */
  kind: text("kind"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const authRateEvents = pgTable("auth_rate_events", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  scope: text("scope").notNull(),
  keyHash: text("key_hash").notNull(),
  at: ts("at").notNull().defaultNow(),
});
