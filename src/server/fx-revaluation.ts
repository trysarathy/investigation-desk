import "server-only";
import { z } from "zod";
import { proposeRevaluations, type ForeignBalance } from "@/lib/clearline/merchant/revaluation";
import { FIAT_DECIMALS } from "@/lib/clearline/merchant/config";
import type { FiatCurrency } from "@/lib/clearline/merchant/types";
import { can } from "./authz";
import { entityOnly } from "./merchant";
import { normRate } from "./merchant-store";
import { and, eq } from "drizzle-orm";
import * as t from "./db/schema";
import { RequestRefused } from "./errors";
import { AccessDenied, type TenantContext, withTenant } from "./tenant";

/**
 * v1 (founder decision 9): period-end revaluation PROPOSALS for an entity's other-currency balances, at the rate
 * recorded in this organisation (fiat_rates, read under its own RLS). Read-only: nothing is stored, exported or
 * posted, and every proposal also waits for the founder's sign-off of the FX posting rules. Finance, an Approver or
 * an Admin only (the same people who may export journals).
 *
 * The balances are given by the caller (e.g. the ledger's trial balance of the receivable from the provider in USD and
 * its carrying value in SGD). [ASSUMPTION, decision needed] Clearline does not yet derive them: it proposes no entry
 * for an other-currency payment or batch until their posting rules are signed off (journal.ts).
 */
const Minor = z.string().regex(/^-?\d{1,20}$/).transform((v) => BigInt(v));
const Balance = z.object({
  account: z.literal("provider_clearing"),
  currency: z.enum(Object.keys(FIAT_DECIMALS) as [FiatCurrency, ...FiatCurrency[]]),
  foreignMinor: Minor,
  carryingMinor: Minor.nullable(),
  ref: z.string().regex(/^[A-Za-z0-9 _.:-]{1,80}$/),
}).strict();
const Input = z.object({ entityId: z.string().min(1).max(64), periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), balances: z.array(Balance).max(100) }).strict();

export async function periodEndRevaluation(ctx: TenantContext, raw: unknown) {
  if (!can(ctx.role, "merchant_export")) throw new AccessDenied(403, `Your role (${ctx.role}) does not allow this.`);
  const parsed = Input.safeParse(raw);
  if (!parsed.success) throw new RequestRefused(422, "BAD_REVALUATION_INPUT", parsed.error.issues[0]?.message ?? "invalid");
  const { entityId, periodEnd, balances } = parsed.data;
  return withTenant({ userId: ctx.userId, orgId: ctx.orgId }, async (tx) => {
    const ent = await entityOnly(tx, ctx, entityId);
    const cur = ent.functionalCurrency as FiatCurrency;
    if (balances.some((b) => b.currency === cur)) throw new RequestRefused(422, "NOT_OTHER_CURRENCY", "Only balances in another currency than the entity's are revalued.");
    const rates = (await tx.select().from(t.fiatRates).where(and(eq(t.fiatRates.orgId, ctx.orgId), eq(t.fiatRates.quoteCurrency, cur))))
      .map((r) => ({ pair: `${r.baseCurrency}/${r.quoteCurrency}`, rate: normRate(r.rate), asOf: r.asOf.toISOString(), source: r.sourceLabel }));
    const entity = { id: ent.id, name: ent.name, functionalCurrency: cur, ledger: ent.ledger, timeZone: { name: ent.timezone, utcOffsetMinutes: ent.utcOffsetMinutes } };
    return proposeRevaluations(entity, periodEnd, balances as ForeignBalance[], rates);
  }, { read: true });
}
