import type { Metadata } from "next";
import { providerMerchants } from "@/server/provider";
import { providerMember } from "@/server/merchant-page";
import s from "@/components/control/control.module.css";
import { Chip, Empty, age } from "@/components/merchant/ui";
import { when } from "@/components/control/ui";

export const metadata: Metadata = { title: "Merchants" };

export default async function ProviderMerchantsPage() {
  const { ctx } = await providerMember();
  const p = await providerMerchants(ctx);
  const now = Date.now();
  return (
    <>
      <h1 className={s.title}>Merchants</h1>
      <p className={s.lede}>Health of every merchant you serve, as aggregates. You see a merchant&rsquo;s payments only if that merchant&rsquo;s Admin has granted your organisation full access.</p>
      {p.merchants.length === 0 ? <Empty>No merchants are onboarded yet.</Empty> : (
        <div className={s.tableWrap} role="region" aria-label="Merchants table" tabIndex={0}>
          <table className={s.table}>
            <thead><tr><th scope="col">Merchant</th><th scope="col" className={s.num}>Payments</th><th scope="col" className={s.num}>Auto-match rate</th><th scope="col" className={s.num}>Exceptions per 100 payments</th><th scope="col">Oldest open exception</th><th scope="col">Last ingestion</th><th scope="col">Access</th></tr></thead>
            <tbody>{p.merchants.map((m) => (
              <tr key={m.merchantOrgId} data-testid="merchant-row">
                <td>{m.name}</td>
                <td className={s.num}>{m.payments}</td>
                <td className={s.num}>{m.autoMatchRatePct === null ? "—" : `${m.autoMatchRatePct}%`}</td>
                <td className={s.num}>{m.exceptionsPer100 ?? "—"}</td>
                <td>{m.oldestOpenExceptionAt ? <>{age(m.oldestOpenExceptionAt, now)} <span className={s.small}>({when(m.oldestOpenExceptionAt)})</span></> : <span className={s.muted}>None open</span>}</td>
                <td>{when(m.lastIngestionAt)}</td>
                <td>{m.grantScope === "full"
                  ? <><Chip tone="info">Full access granted</Chip><br /><a href={`/control/merchant/provider/merchants/${m.merchantOrgId}`}>View payments</a></>
                  : <Chip testId="aggregates-only">Aggregates only</Chip>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <p className={s.small}>Auto-match rate: payments matched without a person (matched, or matched with an explained difference). Exceptions per 100: open exceptions per 100 reconciled payments.</p>
    </>
  );
}
