/**
 * rc6 public cases demo: one case walkthrough. A server component: every figure is rendered from the engine output
 * (reconcile() and proposeJournals() on the case fixtures), never typed in. Test mode · illustrative data.
 */
import Link from "../Link";
import s from "../ui.module.css";
import c from "./cases.module.css";
import {
  ACCOUNT_TEXT, CASE_SHORT, CASE_SLUGS, DECISION_TEXT, DECISION_TONE, DIFFERENCE_TEXT, FACT_TEXT, JOURNAL_KIND_TEXT, LABEL, POSTING_RULE_PENDING,
  bookCurrency, caseModel, decisionCounts, flow, money, needsAttention, networkName, pct, ruleText, signedMoney, summaryFigures, tokenAmount, waterfall,
  type Book, type CaseModel, type CaseSlug,
} from "@/lib/clearline/merchant-cases/view";
import { CASES_HREF } from "@/lib/clearline/merchant-cases/slugs";
import { BANK_EVIDENCE_LABEL, type BatchBridge, type Decision, type JournalProposal, type MatchRecord } from "@/lib/clearline/merchant";

export function TestModeLabel() {
  return (
    <p className={c.label} data-testid="cases-label">
      <span className={c.labelText}>{LABEL}</span>
      <span>Every company, person, wallet and bank account on this page is fictional. Nothing here moves money.</span>
    </p>
  );
}

const Chip = ({ decision }: { decision: Decision }) => (
  <span className={`${c.chip} ${c[DECISION_TONE[decision]]}`}>{DECISION_TEXT[decision]}</span>
);

export function CaseNav({ current }: { current?: CaseSlug }) {
  return (
    <nav aria-label="Case walkthroughs" className={c.caseNav}>
      <ul>
        <li><Link href={CASES_HREF}>All cases</Link></li>
        {CASE_SLUGS.map((slug) => (
          <li key={slug}><Link href={`${CASES_HREF}/${slug}`} aria-current={slug === current ? "page" : undefined}>{CASE_SHORT[slug]}</Link></li>
        ))}
      </ul>
    </nav>
  );
}

const many = (m: CaseModel) => m.books.length > 1;
const bookSuffix = (m: CaseModel, b: Book) => (many(m) ? ` — ${b.title}` : "");

function Summary({ m, b }: { m: CaseModel; b: Book }) {
  const e = b.input.entity;
  const id = `summary-${b.key}`;
  return (
    <section className={c.section} aria-labelledby={id} data-testid={`summary-${b.key}`}>
      <h2 id={id}>Summary{bookSuffix(m, b)}</h2>
      <p className={c.entity}>{e.name} · books in {e.functionalCurrency} · merchant day in {e.timeZone.name} · entity <span className={c.code}>{e.id}</span></p>
      <dl className={c.figures}>
        {summaryFigures(b).map((f) => (
          <div key={f.label} className={c.figure} data-testid={f.testId}>
            <dt>{f.label}</dt>
            <dd>{f.value}{f.note && <span className={c.figNote}>{f.note}</span>}</dd>
          </div>
        ))}
      </dl>
      <ul className={c.counts} aria-label={`Results${bookSuffix(m, b)}`}>
        {decisionCounts(b).map((d) => (
          <li key={d.decision}><Chip decision={d.decision} /> <span className={c.num}>{d.count}</span> <span className={c.code}>{d.decision}</span></li>
        ))}
      </ul>
    </section>
  );
}

function Downloads({ m }: { m: CaseModel }) {
  const base = `${CASES_HREF}/${m.slug}/download`;
  return (
    <section className={c.section} aria-labelledby="downloads">
      <h2 id="downloads">Downloads</h2>
      <p className={c.intro}>Both files carry the label “{LABEL}” and are built from the same engine output as this page.</p>
      <ul className={c.downloads}>
        <li>
          <a className={c.download} href={`${base}/csv`} download data-testid="download-csv">Download CSV (every order)</a>
          <span className={c.downloadNote}>Columns: order, amounts, difference, type, result, rule, owner. One row per difference.</span>
        </li>
        <li>
          <a className={c.download} href={`${base}/pdf`} download data-testid="download-pdf">Download one-page PDF summary</a>
          <span className={c.downloadNote}>A one-page summary of this case for a reviewer.</span>
        </li>
      </ul>
    </section>
  );
}

// ---------- one order ----------

function Evidence({ r, b }: { r: MatchRecord; b: Book }) {
  const cur = bookCurrency(b);
  const L = r.ledger;
  const bank = r.bank;
  return (
    <div className={c.evidence}>
      <section aria-label={`Chain evidence for ${r.orderId}`}>
        <h4>Chain</h4>
        {r.chain.transfers.length === 0 && <p className={c.muted}>No final transfer reached this order.</p>}
        {r.chain.transfers.map((t) => (
          <dl key={`${t.txHash}:${t.logIndex}`}>
            <div><dt>Received</dt><dd className={c.num}>{tokenAmount(t)} on {networkName(t.network)}</dd></div>
            <div><dt>Transaction</dt><dd className={c.code}>{t.txHash}</dd></div>
            <div><dt>To</dt><dd><span className={c.code}>{t.to}</span>{t.linkId ? ` (${t.linkId})` : t.quoteId ? ` (quote ${t.quoteId})` : ""}</dd></div>
            <div><dt>From</dt><dd><span className={c.code}>{t.from}</span>{t.senderFacts.length > 0 && <> · recorded fact: {t.senderFacts.map((f) => FACT_TEXT[f]).join(", ")}</>}</dd></div>
            <div><dt>Time and finality</dt><dd>{t.timestamp.replace("T", " ").replace(".000Z", " UTC")} · {t.confirmations} confirmations</dd></div>
          </dl>
        ))}
        {r.chain.pending.length > 0 && <p>Pending (not yet final): {r.chain.pending.map((p) => p.txHash).join(", ")}</p>}
      </section>
      <section aria-label={`Provider evidence for ${r.orderId}`}>
        <h4>Provider</h4>
        {r.provider.records.map((p) => (
          <dl key={p.providerPaymentId}>
            <div><dt>Record</dt><dd className={c.code}>{p.providerPaymentId}</dd></div>
            <div><dt>Status claimed</dt><dd><span className={c.code}>{p.statusClaim}</span>{p.displayedStatus ? ` · dashboard shows “${p.displayedStatus}”` : ""}</dd></div>
            <div><dt>Credited</dt><dd className={c.num}>{money(p.creditedMinor, cur)} at {p.executedRate}</dd></div>
            <div><dt>Settlement batch</dt><dd className={c.code}>{p.batchId ?? "none"}</dd></div>
          </dl>
        ))}
        <p className={c.muted}>Provider statuses are claims, not proof.</p>
      </section>
      <section aria-label={`Bank evidence for ${r.orderId}`}>
        <h4>Bank</h4>
        <dl>
          <div><dt>Status</dt><dd className={c.code}>{bank.status}</dd></div>
          <div><dt>Batch</dt><dd className={c.code}>{bank.batchIds.join(", ") || "none"}</dd></div>
          <div><dt>Bank line</dt><dd className={c.code}>{bank.bankLineIds.join(", ") || "none"}</dd></div>
          <div><dt>Batch ties to the cent</dt><dd>{bank.batchTied ? "Yes" : "No"}</dd></div>
          <div><dt>Settlement verified</dt><dd>{bank.settlementVerified ? "Yes, bank feed" : "No"}{bank.bankLineLabels.length > 0 && ` (${bank.bankLineLabels.join(", ")})`}</dd></div>
          <div><dt>Bank evidence</dt><dd>{BANK_EVIDENCE_LABEL[bank.evidence].replace(/^Bank evidence: /, "")}{bank.settled ? " · settled" : " · not settled"}</dd></div>
        </dl>
      </section>
      <section aria-label={`Ledger evidence for ${r.orderId}`}>
        <h4>Ledger</h4>
        <dl>
          <div><dt>Invoice</dt><dd className={c.num}>{money(L.invoice.amountMinor, cur)}</dd></div>
          <div><dt>Credited</dt><dd className={c.num}>{money(L.creditedMinor, cur)}</dd></div>
          <div><dt>Open balance</dt><dd className={c.num} data-testid={`open-${r.orderId}`}>{money(L.openBalanceMinor, cur)} · {L.balanceLabel}</dd></div>
          {L.customerOverpaymentMinor > 0n && <div><dt>Customer overpayment (liability)</dt><dd className={c.num} data-testid={`liability-${r.orderId}`}>{money(L.customerOverpaymentMinor, cur)}</dd></div>}
        </dl>
      </section>
    </div>
  );
}

function OrderCard({ r, b, m }: { r: MatchRecord; b: Book; m: CaseModel }) {
  const e = r.explanation;
  const wo = b.result.writeOffs.find((w) => w.orderId === r.orderId);
  const hid = `order-${b.key}-${r.orderId}`;
  return (
    <article className={c.card} aria-labelledby={hid} data-testid={`order-${r.orderId}`} data-decision={e.decision}>
      <div className={c.cardHead}>
        <h3 id={hid}>{r.orderId}{many(m) ? ` (${b.input.entity.functionalCurrency})` : ""}</h3>
        <Chip decision={e.decision} />
        <span className={c.code}>{e.decision}</span>
      </div>
      <div className={c.cardBody}>
        <dl className={c.facts}>
          <div><dt>Result</dt><dd>{DECISION_TEXT[e.decision]}</dd></div>
          <div><dt>Deciding step</dt><dd>Step {e.decidingStep}</dd></div>
          <div><dt>Rule</dt><dd><span className={c.code}>{e.ruleId}</span><br />{ruleText(e.ruleId)}</dd></div>
        </dl>
        {e.differences.length > 0 && (
          <div>
            <p className={c.subhead}>Typed differences</p>
            <ul className={c.diffs}>
              {e.differences.map((d) => (
                <li key={d.id} className={c.diff} data-testid={`diff-${d.id}`}>
                  <strong>{DIFFERENCE_TEXT[d.type]}</strong> <span className={c.code}>{d.type}</span> · <span className={c.num}>{signedMoney(d.amountMinor, d.currency)}</span>
                  <br />{d.reason} <span className={c.muted}>Rule <span className={c.code}>{d.ruleId}</span>.</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {wo && (
          <p className={c.diff} data-testid={`writeoff-${r.orderId}`}>
            <strong>Write-off proposed:</strong> <span className={c.num}>{money(wo.amountMinor, wo.currency)}</span> ({wo.direction}). Prepared by the engine; it needs approval by a second person ({wo.approverRoles.join(", ")}) before anything is posted.
          </p>
        )}
        {r.attention && (
          <div className={`${c.attention} ${e.decision === "exception" ? "" : c.attentionReview}`} data-testid={`attention-${r.orderId}`}>
            <p className={c.subhead}>{e.decision === "exception" ? "Exception" : "Needs review"}</p>
            <dl>
              <div><dt>Reason</dt><dd>{r.attention.reason}</dd></div>
              <div><dt>Owner</dt><dd>{r.attention.owner}</dd></div>
              <div><dt>Next step</dt><dd>{r.attention.nextStep}</dd></div>
            </dl>
          </div>
        )}
        <Evidence r={r} b={b} />
        <details className={c.history}>
          <summary>Steps checked for {r.orderId} ({e.history.length})</summary>
          <ol>
            {e.history.map((h, i) => (
              <li key={i}>Step {h.step} · <span className={c.code}>{h.ruleId}</span> · {h.outcome}: {h.detail}</li>
            ))}
          </ol>
        </details>
      </div>
    </article>
  );
}

/** Clean matches (Case 2 has 41): one row each, with the same evidence in short. */
function MatchedTable({ rows, b, m }: { rows: MatchRecord[]; b: Book; m: CaseModel }) {
  const cur = bookCurrency(b);
  const cap = `Matched orders${bookSuffix(m, b)} (${rows.length})`;
  return (
    <div className={c.tableRegion} role="region" aria-label={cap} tabIndex={0}>
      <table className={`${c.table} ${c.stack}`} data-testid={`matched-${b.key}`}>
        <caption>{cap}</caption>
        <thead>
          <tr><th scope="col">Order</th><th scope="col">Result</th><th scope="col">Rule and step</th><th scope="col">Chain</th><th scope="col">Provider</th><th scope="col">Bank</th><th scope="col" className={c.r}>Ledger</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const t = r.chain.transfers[0];
            const p = r.provider.records[0];
            return (
              <tr key={r.orderId} data-testid={`order-${r.orderId}`} data-decision={r.explanation.decision}>
                <td data-label="Order" className={c.code}>{r.orderId}</td>
                <td data-label="Result"><Chip decision={r.explanation.decision} /></td>
                <td data-label="Rule and step"><span className={c.code}>{r.explanation.ruleId}</span> · step {r.explanation.decidingStep}</td>
                <td data-label="Chain">{t ? <>{tokenAmount(t)} · <span className={c.code}>{t.txHash}</span></> : "none"}</td>
                <td data-label="Provider">{p ? <><span className={c.code}>{p.providerPaymentId}</span> · {p.statusClaim}</> : "none"}</td>
                <td data-label="Bank"><span className={c.code}>{r.bank.batchIds.join(", ")}</span> → <span className={c.code}>{r.bank.bankLineIds.join(", ")}</span>{r.bank.settlementVerified ? " · verified" : ""}</td>
                <td data-label="Ledger" className={`${c.r} ${c.num}`}>{money(r.ledger.creditedMinor, cur)} of {money(r.ledger.invoice.amountMinor, cur)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Items({ m, b }: { m: CaseModel; b: Book }) {
  const recs = b.result.records;
  const compact = recs.length > 8;
  const cards = compact ? recs.filter(needsAttention) : recs;
  const rest = compact ? recs.filter((r) => !needsAttention(r)) : [];
  const id = `orders-${b.key}`;
  return (
    <section className={c.section} aria-labelledby={id}>
      <h2 id={id}>Every order{bookSuffix(m, b)}</h2>
      <p className={c.intro}>
        Each order shows its result, the rule and the step that decided it, the evidence from the chain, the provider, the bank and the ledger, and every typed difference with its reason.
        {compact && " Orders that need a person come first; the clean matches follow in a table."}
      </p>
      <div className={c.cards}>{cards.map((r) => <OrderCard key={r.orderId} r={r} b={b} m={m} />)}</div>
      {rest.length > 0 && <div className={c.tie}><MatchedTable rows={rest} b={b} m={m} /></div>}
      {b.result.transferFindings.length > 0 && (
        <ul>{b.result.transferFindings.map((f) => <li key={f.transfer.txHash}>{f.transfer.txHash}: {f.detail} (rule {f.ruleId})</li>)}</ul>
      )}
    </section>
  );
}

// ---------- Case 2 ----------

function IdList({ ids, what }: { ids: string[]; what: string }) {
  if (ids.length <= 6) return <span>Payment IDs: {ids.map((x, i) => <span key={x}>{i ? ", " : ""}<span className={c.code}>{x}</span></span>)}</span>;
  return (
    <details className={c.ids}>
      <summary>Show the {ids.length} payment IDs for {what}</summary>
      <p>{ids.map((x, i) => <span key={x}>{i ? ", " : ""}<span className={c.code}>{x}</span></span>)}</p>
    </details>
  );
}

function Waterfall({ br, b }: { br: BatchBridge; b: Book }) {
  const { lines, maxMinor } = waterfall(br);
  const id = `bridge-${br.batchId}`;
  const bank = b.input.bankLines.find((l) => l.bankLineId === br.bankLineId);
  return (
    <section className={c.section} aria-labelledby={id} data-testid={`waterfall-${br.batchId}`}>
      <h2 id={id}>From the merchant&apos;s day to the bank credit — batch {br.batchId}</h2>
      <p className={c.intro}>
        Merchant day {br.merchantDay} in {br.merchantTimeZone.name}; the provider&apos;s day is {br.providerDay} in {br.providerTimeZone.name}. Each line names the payments behind it. Bars are drawn to scale; the amounts are the figures.
      </p>
      <ol className={c.waterfall}>
        {lines.map((l, i) => {
          const lo = l.startMinor < l.endMinor ? l.startMinor : l.endMinor;
          const hi = l.startMinor < l.endMinor ? l.endMinor : l.startMinor;
          const tone = l.total ? c.barTotal : l.amountMinor < 0n ? c.barDown : c.barUp;
          return (
            <li key={i} className={`${c.wLine} ${l.total ? c.wTotal : ""}`} data-testid={`wf-${l.kind}`}>
              <div className={c.wLabel}>
                <strong>{l.label}</strong>
                <span className={c.muted}>{l.reason}{l.differenceType ? ` Type: ${l.differenceType}.` : ""}</span>
              </div>
              <div className={c.wAmount} data-testid={`wf-amount-${l.kind}`}>{l.display}</div>
              <div className={c.wTrack} aria-hidden="true">
                <div className={`${c.wBar} ${tone}`} style={{ left: `${pct(lo, maxMinor)}%`, width: `${pct(hi - lo, maxMinor)}%` }} />
              </div>
              <div className={c.wIds}><IdList ids={l.paymentIds} what={l.label} /></div>
            </li>
          );
        })}
      </ol>
      <p className={c.tie} data-testid={`tie-${br.batchId}`}>
        {bank ? <>Bank credit <span className={c.code}>{bank.bankLineId}</span> on {bank.valueDate} to {bank.account} (fictional): <strong className={c.num}>{money(bank.amountMinor, bank.currency)}</strong>. </> : "No bank line found. "}
        {br.tied ? "The batch ties to the cent: gross − fees − refunds = net = the bank line." : "The batch does not tie."}{" "}
        {br.settlementVerified ? "Settlement is verified from the bank feed." : "Settlement is not verified."}
      </p>
    </section>
  );
}

function OtherBatch({ br, b }: { br: BatchBridge; b: Book }) {
  const cur = bookCurrency(b);
  const id = `batch-${br.batchId}`;
  const get = (k: string) => br.lines.find((l) => l.kind === k);
  return (
    <section className={c.section} aria-labelledby={id} data-testid={`batch-${br.batchId}`}>
      <h2 id={id}>Prior batch {br.batchId}</h2>
      <p className={c.intro}>
        Settled the orders of the previous provider day. Gross {money(get("gross")!.amountMinor, cur)}, fee {signedMoney(get("provider_fee")!.amountMinor, cur)}, net{" "}
        {money(get("net")!.amountMinor, cur)} to bank line <span className={c.code}>{br.bankLineId}</span>. {br.tied ? "Ties to the cent." : "Does not tie."}
      </p>
      <IdList ids={br.paymentIds} what={`batch ${br.batchId}`} />
    </section>
  );
}

// ---------- Case 3 ----------

function Flow({ b, after }: { b: Book; after?: Book }) {
  const cur = bookCurrency(b);
  const rec = b.result.records[0];
  const gap = rec.ledger.invoice.amountMinor - rec.ledger.creditedMinor;
  const r1 = after?.result.records[0];
  return (
    <section className={c.section} aria-labelledby="flow" data-testid="flow">
      <h2 id="flow">How the money arrived</h2>
      <p className={c.intro}>Invoice {rec.orderId} for {money(rec.ledger.invoice.amountMinor, cur)}, paid in two parts. Each step of the path is shown as it was recorded.</p>
      <div className={c.flows}>
        {flow(b).map((p) => (
          <div key={p.linkId} className={c.flowPart} data-testid={`flow-part-${p.part}`}>
            <h3>Part {p.part}: {tokenAmount(p.transfer)} on {p.network} through {p.linkId} ({p.linkKind})</h3>
            <ol className={c.flow} aria-label={`Path of part ${p.part}`}>
              {p.nodes.map((n, i) => {
                const hop = n.role !== "sender" && n.role !== "deposit" ? p.hops.find((h) => h.to === n.address) : undefined;
                const next = p.nodes[i + 1];
                const nextHop = next && p.hops.find((h) => h.to === next.address);
                return (
                  <li key={n.address} className={c.flowStep}>
                    <div className={`${c.node} ${n.role === "deposit" ? c.nodeDeposit : ""}`}>
                      <span className={c.nodeRole}>{n.role === "sender" ? "Sent from" : n.role === "hop" ? "Passed through" : "Received at"}</span>
                      <strong>{n.facts.join(", ") || "No recorded fact"}</strong>
                      <span className={`${c.code} ${c.nodeRole}`}>{n.address}</span>
                      {hop && <span className={c.nodeRole}>hop recorded in <span className={c.code}>{hop.txHash}</span></span>}
                    </div>
                    {next && (
                      <div className={c.edge}>
                        <span className={c.arrow} aria-hidden="true">→</span>
                        <span>{nextHop ? `then, in transfer ${nextHop.txHash}` : `${tokenAmount(p.transfer)} in transfer ${p.transfer.txHash}`}</span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            <p className={c.factNote}>
              Provider record <span className={c.code}>{p.provider.id}</span> (claims <span className={c.code}>{p.provider.claim}</span>) credited <strong className={c.num}>{p.provider.credited}</strong> at {p.provider.rate}
              {p.provider.batchId ? <>, settled in batch <span className={c.code}>{p.provider.batchId}</span></> : ""}.
            </p>
          </div>
        ))}
      </div>
      <p className={c.factNote}>The hop through an intermediate wallet and the exchange sender are recorded facts. They are not judgements about anyone, and they never decide a match.</p>
      <dl className={c.figures} style={{ marginTop: 12 }}>
        <div className={c.figure} data-testid="fig-total-credited"><dt>Credited in total</dt><dd>{money(rec.ledger.creditedMinor, cur)}</dd></div>
        <div className={c.figure} data-testid="fig-gap">
          <dt>Gap to the invoice</dt>
          <dd>{money(gap, cur)}<span className={c.figNote}>= {rec.explanation.differences.map((d) => `${money(-d.amountMinor, d.currency)} ${DIFFERENCE_TEXT[d.type].toLowerCase()}`).join(" + ")}</span></dd>
        </div>
        {r1 && (
          <div className={c.figure} data-testid="fig-after-part1">
            <dt>Open balance after part 1</dt>
            <dd>{money(r1.ledger.openBalanceMinor, cur)}<span className={c.figNote}>{r1.ledger.balanceLabel}, not overdue: the balance link {b.input.paymentLinks.find((l) => l.kind === "balance")?.linkId} was still open ({DECISION_TEXT[r1.explanation.decision].toLowerCase()}, rule {r1.explanation.ruleId}).</span></dd>
          </div>
        )}
      </dl>
    </section>
  );
}

// ---------- journals ----------

function Journal({ j }: { j: JournalProposal }) {
  const cur = j.currency;
  const hid = `journal-${j.id}`;
  return (
    <article className={c.journal} aria-labelledby={hid} data-testid={`journal-${j.id}`}>
      <div className={c.cardHead}>
        <h3 id={hid} className={c.code}>{j.id}</h3>
        <span>{JOURNAL_KIND_TEXT[j.kind]}</span>
        <span className={`${c.chip} ${c.warn}`} data-testid="posting-pending">{POSTING_RULE_PENDING}</span>
      </div>
      <div className={c.cardBody}>
        <p style={{ margin: 0 }}>{j.memo} {j.entryDate ? `Entry date ${j.entryDate}.` : "No entry date until it is approved."} Rule <span className={c.code}>{j.ruleId}</span>.</p>
        <div className={c.tableRegion}>
          <table className={c.table}>
            <caption className={s.srOnly}>Lines of {j.id}</caption>
            <thead><tr><th scope="col">Account</th><th scope="col" className={c.r}>Debit</th><th scope="col" className={c.r}>Credit</th></tr></thead>
            <tbody>
              {j.lines.map((l, i) => (
                <tr key={i}>
                  <td>{ACCOUNT_TEXT[l.account]}{l.bankAccount ? ` (${l.bankAccount}, fictional)` : ""}</td>
                  <td className={`${c.r} ${c.num}`}>{l.side === "debit" ? money(l.amountMinor, cur) : ""}</td>
                  <td className={`${c.r} ${c.num}`}>{l.side === "credit" ? money(l.amountMinor, cur) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </article>
  );
}

function Journals({ m, b }: { m: CaseModel; b: Book }) {
  const id = `journals-${b.key}`;
  return (
    <section className={c.section} aria-labelledby={id}>
      <h2 id={id}>Proposed journal entries{bookSuffix(m, b)} ({b.journals.length})</h2>
      <p className={c.intro}>Every entry is a proposal. Its posting rule is pending sign-off, and nothing is posted to any ledger from this page.</p>
      <div className={c.journals}>{b.journals.map((j) => <Journal key={j.id} j={j} />)}</div>
    </section>
  );
}

// ---------- page ----------

export default function CaseView({ slug }: { slug: CaseSlug }) {
  const m = caseModel(slug);
  return (
    <div data-testid="case-page" data-case={slug}>
      <TestModeLabel />
      <div className={s.pageHead}>
        <div>
          <p className={s.eyebrow}>Merchant reconciliation · case {m.number} of 3</p>
          <h1>Case {m.number}: {m.title}</h1>
          <p className={s.lede}>{m.lede}</p>
        </div>
      </div>
      <CaseNav current={slug} />
      <Downloads m={m} />
      {m.books.map((b) => <Summary key={b.key} m={m} b={b} />)}
      {m.number === 2 && m.books.flatMap((b) => {
        const prior = (br: BatchBridge) => br.lines.find((l) => l.kind === "merchant_day")?.amountMinor === 0n;
        return [
          ...b.result.bridges.filter((br) => !prior(br)).map((br) => <Waterfall key={br.batchId} br={br} b={b} />),
          ...b.result.bridges.filter(prior).map((br) => <OtherBatch key={br.batchId} br={br} b={b} />),
        ];
      })}
      {m.number === 3 && <Flow b={m.books[0]} after={m.afterPart1} />}
      {m.books.map((b) => <Items key={b.key} m={m} b={b} />)}
      {m.books.map((b) => <Journals key={b.key} m={m} b={b} />)}
    </div>
  );
}

