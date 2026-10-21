import Link from "next/link";
import { redirect } from "next/navigation";
import { Mono } from "@/components/Mono";
import { Status } from "@/components/Status";
import { normaliseInput } from "@/lib/normalise";
import { resolveInput } from "@/lib/view";

const KIND_LABEL = {
  hash: "Transaction hash",
  tron_address: "Tron address",
  evm_address: "EVM address",
  customer_ref: "Customer reference",
  unrecognised: "Unrecognised reference (possibly an exchange withdrawal ID)",
} as const;

/** Pasted input lands here: open the matching case, or explain why no verdict is possible yet. */
export default async function InvestigatePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const match = q.trim() ? resolveInput(q) : undefined;
  if (match) redirect(`/cases/${match.id}`);
  const input = normaliseInput(q);

  return (
    <div className="page">
      <div className="page-head">
        <h1>New case</h1>
        <Link className="btn" href="/">Back <span className="kbd">Esc</span></Link>
      </div>
      <div className="verdict-bar paused" role="status">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="verdict-title">Check paused</div>
          <div className="muted">
            Live chain lookups are not connected in this prototype, so no verdict is given. Only sample cases can be investigated.
          </div>
        </div>
      </div>
      <section className="panel">
        <dl className="kv">
          <dt>Input</dt>
          <dd>{q.trim() ? <Mono value={q.trim()} head={10} tail={10} /> : <span className="faint">Nothing pasted</span>}</dd>
          <dt>Detected as</dt>
          <dd>{q.trim() ? KIND_LABEL[input.kind] : "—"}</dd>
          <dt>Chains to check</dt>
          <dd>{input.kind === "hash" ? "Tron, Ethereum, BNB Chain, then Polygon, Base, Arbitrum, Optimism" : input.kind === "tron_address" ? "Tron" : input.kind === "evm_address" ? "Ethereum, BNB Chain" : "Looked up in File A"}</dd>
          <dt>Status</dt>
          <dd><Status status="warn" label="Waiting for chain fetchers (build week 2)" /></dd>
        </dl>
      </section>
    </div>
  );
}
