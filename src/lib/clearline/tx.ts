import type { ActionContext, Actor, ActorRole, AuditEvent, EngineError, Workspace } from "./types";

/**
 * Internal action transaction. Each public action deep-clones the workspace once, mutates the
 * private draft through a Tx and returns the draft. Callers never observe mutation, so actions
 * remain pure from the outside.
 */
export class Tx {
  readonly ws: Workspace;
  readonly audit: AuditEvent[] = [];
  readonly created: string[] = [];
  readonly ctx: ActionContext;
  constructor(source: Workspace, ctx: ActionContext) {
    this.ws = structuredClone(source);
    // M4: every stored instant is a canonical UTC string, whatever offset the caller used.
    this.ctx = { actorId: ctx.actorId, at: new Date(Date.parse(ctx.at)).toISOString() };
  }
  /** Today's calendar date in the organisation's time zone (M5). */
  get today(): string {
    return orgDate(this.ctx.at, this.ws.organization.timezone);
  }
  orgDate(iso: string): string {
    return orgDate(iso, this.ws.organization.timezone);
  }
  get at(): string {
    return this.ctx.at;
  }
  get actorId(): string {
    return this.ctx.actorId;
  }
  actor(): Actor | undefined {
    return this.ws.actors.find((a) => a.id === this.ctx.actorId);
  }
  /** Deterministic sequential id. */
  id(prefix: string): string {
    this.ws.seq += 1;
    return `${prefix}_${String(this.ws.seq).padStart(5, "0")}`;
  }
  log(action: string, entityType: string, entityId: string, summary: string): void {
    const event: AuditEvent = { id: this.id("aud"), at: this.at, actorId: this.actorId, action, entityType, entityId, summary };
    this.ws.audit.push(event);
    this.audit.push(event);
  }
}

/** Thrown inside a Tx to abort the whole action; converted to a typed error by applyAction. */
export class Abort extends Error {
  constructor(readonly engineError: EngineError) {
    super(engineError.message);
  }
}

export function fail(code: EngineError["code"], message: string, extra: Partial<EngineError> = {}): never {
  throw new Abort({ code, message, ...extra });
}

export function requireRole(tx: Tx, roles: ActorRole[]): Actor {
  const actor = tx.actor();
  if (!actor) fail("unauthorized_actor", "Unknown actor.", { field: "actorId" });
  if (!roles.includes(actor.role)) fail("unauthorized_actor", `This action requires role: ${roles.join(" or ")}.`, { field: "actorId" });
  return actor;
}

export const isIsoInstant = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(v) && !Number.isNaN(Date.parse(v));

export const isIsoDate = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

export const ms = (iso: string) => Date.parse(iso);
export const minutesBetween = (a: string, b: string) => Math.floor((ms(b) - ms(a)) / 60000);
export const addMinutes = (iso: string, minutes: number) => new Date(ms(iso) + minutes * 60000).toISOString();
/** UTC calendar date of an instant. Prefer orgDate for business rules. */
export const dateOf = (iso: string) => new Date(ms(iso)).toISOString().slice(0, 10);
/** Canonical UTC instant ("…Z"); every stored timestamp uses this form. */
export const toUtc = (iso: string) => new Date(ms(iso)).toISOString();

const DATE_FMT = new Map<string, Intl.DateTimeFormat>();
/** Calendar date (YYYY-MM-DD) of an instant in an IANA time zone (the organisation's). */
export function orgDate(iso: string, timeZone: string): string {
  let f = DATE_FMT.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    DATE_FMT.set(timeZone, f);
  }
  const parts = Object.fromEntries(f.formatToParts(new Date(ms(iso))).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export const isTimeZone = (tz: unknown): tz is string => {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
/** Add whole days to a YYYY-MM-DD calendar date. */
export const addDays = (date: string, days: number) => new Date(Date.parse(date + "T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);
/** Whole days from calendar date a to calendar date b. */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);

/** Fictional free text: letters, digits and simple punctuation only (no markup). */
export const safeText = (v: unknown, min = 2, max = 120): v is string =>
  typeof v === "string" && v.length >= min && v.length <= max && /^[\p{L}\p{N} ()/.,:;'_&#+\-]+$/u.test(v);

/** Notes: printable text without markup or control characters. */
export const safeNote = (v: unknown, max = 1000): v is string =>
  typeof v === "string" && v.trim().length >= 1 && v.length <= max && !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);

/** Stable JSON (sorted keys) for fingerprints. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  if (value && typeof value === "object")
    return "{" + Object.keys(value as Record<string, unknown>).sort().filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => JSON.stringify(k) + ":" + stableStringify((value as Record<string, unknown>)[k])).join(",") + "}";
  return JSON.stringify(value);
}

/** Reference tokens for exact reference matching (case-insensitive, whole tokens only). */
export const referenceTokens = (reference: string): string[] =>
  reference.normalize("NFKC").toUpperCase().split(/[^A-Z0-9_\-]+/).filter(Boolean);
