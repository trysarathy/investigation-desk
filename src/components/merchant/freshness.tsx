import type { SourceFreshness } from "@/server/merchant-ui";
import s from "@/components/control/control.module.css";
import m from "./merchant.module.css";
import { whenIn } from "./ui";

/**
 * Data freshness (server component): per independent source, when its newest file or record arrived. Read from data
 * the server already holds; a source with nothing yet says "not yet received". Times in UTC, the provider day's zone.
 */
export function FreshnessStrip({ provider, bank, chain }: { provider: SourceFreshness | null; bank: SourceFreshness | null; chain: string | null }) {
  const items: { key: string; name: string; v: SourceFreshness | null }[] = [
    { key: "provider", name: "Provider file", v: provider },
    { key: "bank", name: "Bank statement", v: bank },
    { key: "chain", name: "Chain", v: chain ? { at: chain, what: "record" } : null },
  ];
  const at = (v: SourceFreshness) => (/^\d{4}-\d{2}-\d{2}$/.test(v.at) ? v.at : whenIn(v.at));
  return (
    <section className={m.freshness} aria-label="Data freshness" data-testid="freshness-strip">
      <h2 className={m.freshnessTitle}>Data freshness</h2>
      <ul className={m.freshnessList}>
        {items.map((x) => (
          <li key={x.key} className={m.freshnessItem} data-testid={`freshness-${x.key}`} data-state={x.v ? "received" : "missing"}>
            <span className={m.freshnessName}>{x.name}</span>
            {x.v ? <span><time className="tabular-nums" dateTime={x.v.at}>{at(x.v)}</time> <span className={s.small}>{x.v.what === "upload" ? "newest upload" : x.key === "chain" ? "newest transfer" : "newest record"}</span></span>
              : <span className={s.muted}>not yet received</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
