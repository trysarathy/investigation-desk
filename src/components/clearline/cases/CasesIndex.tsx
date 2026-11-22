/** rc6 public cases demo: the index of the three walkthroughs. Figures come from the engine output. */
import Link from "../Link";
import s from "../ui.module.css";
import c from "./cases.module.css";
import { TestModeLabel } from "./CaseView";
import { DECISION_TEXT, allCases, decisionCounts, summaryFigures } from "@/lib/clearline/merchant-cases/view";
import { CASES_HREF } from "@/lib/clearline/merchant-cases/slugs";

export default function CasesIndex() {
  return (
    <div data-testid="cases-index">
      <TestModeLabel />
      <div className={s.pageHead}>
        <div>
          <p className={s.eyebrow}>Merchant reconciliation</p>
          <h1>Three reconciliation cases, step by step</h1>
          <p className={s.lede}>
            How Clearline matches stablecoin payments to invoices, settlement batches and bank credits for a merchant. Each walkthrough shows every
            order, the rule that decided it, the evidence behind it and the journal entries it would propose. No sign-in; every figure comes from the
            reconciliation engine run on fictional data.
          </p>
        </div>
      </div>
      <ul className={c.caseList}>
        {allCases().map((m) => (
          <li key={m.slug} className={c.caseItem} data-testid={`case-card-${m.slug}`}>
            <h2><Link href={`${CASES_HREF}/${m.slug}`}>Case {m.number}: {m.title}</Link></h2>
            <p>{m.lede}</p>
            {m.books.map((b) => {
              const net = summaryFigures(b).find((f) => f.testId === "fig-net")!;
              return (
                <p key={b.key} className={c.muted}>
                  {b.title}: {b.result.records.length} orders · net bank credit {net.value} · {decisionCounts(b).map((d) => `${d.count} ${DECISION_TEXT[d.decision].toLowerCase()}`).join(", ")}
                </p>
              );
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}
