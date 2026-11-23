import { PaymentFilters, listMerchantPayments } from "@/server/merchant";
import { read } from "@/server/control-http";
import { organisationDataMode } from "@/server/mapping-templates";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

const INT = new Set(["minAgeDays", "maxAgeDays"]);

/** The merchant's payments with the list filters (result, differenceType, network, token, batchId, age, search). */
export const GET = (req: Request) => read(req, async (ctx) => {
  const q = Object.fromEntries([...new URL(req.url).searchParams.entries()].filter(([, v]) => v !== "").map(([k, v]) => [k, INT.has(k) ? Number(v) : v]));
  return json(200, { label: (await organisationDataMode(ctx)).label, payments: await listMerchantPayments(ctx, PaymentFilters.parse(q)) });
});
