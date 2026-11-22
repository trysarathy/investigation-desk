import type { Metadata } from "next";
import { pageContext } from "@/server/control-page";
import s from "@/components/control/control.module.css";
import { PageTitle } from "@/components/control/ui";

export const metadata: Metadata = { title: "Accounting" };

/** Placeholder: Clearline Control has no read service for the Accounting Bridge yet, and this page shows no data. */
export default async function AccountingPage() {
  await pageContext();
  return (
    <>
      <PageTitle title="Accounting" />
      <div className={s.panel}>
        <p><strong>Coming in a following change.</strong></p>
        <p className={s.small}>Journal proposals, accounting periods and exports are not shown here yet. Nothing on this page is data.</p>
      </div>
    </>
  );
}
