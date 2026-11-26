import type { Metadata } from "next";
import { orNotFound } from "@/server/control-page";
import { AccessDenied } from "@/server/tenant";
import { providerMerchantPayments } from "@/server/provider";
import { providerMember } from "@/server/merchant-page";
import s from "@/components/control/control.module.css";
import { DecisionChip, EvidenceChip } from "@/components/merchant/ui";

export const metadata: Metadata = { title: "Merchant payments" };

export default async function ProviderMerchantPaymentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await providerMember();
  const id = (await params).id;
  let r: Awaited<ReturnType<typeof providerMerchantPayments>>;
  try { r = await orNotFound(providerMerchantPayments(ctx, id)); } catch (e) {
    if (e instanceof AccessDenied && e.status === 403) {
      return (
        <>
          <p className={s.small}><a href="/control/merchant/provider">← Merchants</a></p>
          <h1 className={s.title}>Payments not available</h1>
          <p className={s.warnBox} role="alert" data-testid="no-grant">This merchant has not granted your organisation full access. You see its aggregates only.</p>
        </>
      );
    }
    throw e;
  }
  return (
    <>
      <p className={s.small}><a href="/control/merchant/provider">← Merchants</a></p>
      <h1 className={s.title}>{r.merchant.name}: payments</h1>
      <p className={s.lede}>Read-only, under the full access this merchant&rsquo;s Admin granted. The merchant can take it back at any time.</p>
      <div className={s.tableWrap} role="region" aria-label="Merchant payments table" tabIndex={0}>
        <table className={s.table}>
          <thead><tr><th scope="col">Order</th><th scope="col">Explanation</th><th scope="col">Rule</th><th scope="col">Bank evidence</th></tr></thead>
          <tbody>{r.payments.map((p) => <tr key={p.orderId}><td className={s.mono}>{p.orderId}</td><td><DecisionChip decision={p.decision} /></td><td className={s.mono}>{p.ruleId}</td><td><EvidenceChip level={p.bankEvidence} label={p.bankEvidenceLabel} />{p.settled ? " · settled" : ""}</td></tr>)}</tbody>
        </table>
      </div>
    </>
  );
}
