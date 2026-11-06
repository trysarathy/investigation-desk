"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { FundingData, ImportKind, User } from "@/lib/funding/model";
import type { Review } from "@/lib/funding/review";
import type {
  OwedRow,
  LedgerException,
  Allocation,
} from "@/lib/funding/ledger";
import styles from "./FundingDesk.module.css";
import { parseCsv, decodeUtf8 } from "@/lib/csv/parse";

type Snapshot = {
  user: User;
  csrf: string;
  at: string;
  simulation: boolean;
  revision: number;
  data: FundingData;
  ledger: {
    rows: OwedRow[];
    exceptions: LedgerException[];
    allocations: Allocation[];
  };
  reviews: Record<string, Review | null>;
  digest: string;
  columns: Record<ImportKind, string[]>;
};
type Tab = "Approvals" | "Exceptions" | "Settings";
const kinds: ImportKind[] = [
  "customers",
  "advances",
  "cash",
  "payouts",
  "receipts",
];
const money = (amount: string, currency: string) => {
  const [whole, cents = ""] = amount.split(".");
  return `${currency} ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents.padEnd(2, "0")}`;
};
const words = (value: string) => value.replaceAll("_", " ");
const time = (value: string) => value.replace("T", " ").replace("Z", " UTC");

export default function FundingDesk() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<Tab>("Approvals");
  const [selected, setSelected] = useState("");
  const [reason, setReason] = useState("");
  const [clock, setClock] = useState("");
  const [kind, setKind] = useState<ImportKind>("advances");
  const currentKind = useRef<ImportKind>("advances");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [headers, setHeaders] = useState<string[]>([]);
  const [importText, setImportText] = useState("");
  const fileGeneration = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function refresh() {
    const response = await fetch("/api/funding?session=1", {
      cache: "no-store",
    });
    if (response.status === 401) {
      setSnapshot(null);
      return;
    }
    const result = await response.json();
    if (result.authenticated === false) {
      setSnapshot(null);
      return;
    }
    if (!response.ok)
      throw Error(result.error || "The desk could not load. Try again.");
    setSnapshot(result);
    setClock(result.at);
  }
  useEffect(() => {
    refresh()
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoaded(true));
  }, []);

  async function send(body: Record<string, unknown>, download?: string) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/funding", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(snapshot ? { "x-csrf-token": snapshot.csrf } : {}),
        },
        body: JSON.stringify({ revision: snapshot?.revision, ...body }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        if (response.status === 401) setSnapshot(null);
        throw Error(
          result.error ||
            "That action could not be completed. Reload and try again.",
        );
      }
      if (download) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        const supplied = response.headers
          .get("Content-Disposition")
          ?.match(/filename="([A-Za-z0-9_.-]+)"/);
        link.download = supplied?.[1] || download;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setNotice(
          "File prepared. Review it before sharing or importing it elsewhere.",
        );
      } else {
        if (body.action === "logout") {
          setSelected("");
          setReason("");
          setTab("Approvals");
          setFile(null);
          setHeaders([]);
          setImportText("");
          setMapping({});
          setEmail("");
        }
        await refresh();
        setPassword("");
        setNotice(body.action === "logout" ? "Signed out." : "Recorded.");
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Something went wrong. Try again.",
      );
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  const exportFile = (format: string, filename: string, advance_id?: string) =>
    send({ action: "export", format, advance_id }, filename);
  const advance = snapshot?.data.advances.find((a) => a.id === selected);
  const row = snapshot?.ledger.rows.find((a) => a.advance_id === selected);
  const review = snapshot?.reviews[selected];
  const operator = snapshot?.user.role === "operator";
  const approver = snapshot?.user.role === "approver";
  const customerName = (id: string) =>
    snapshot?.data.customers.find((c) => c.id === id)?.name || id;
  const open = (id: string) => {
    setSelected(id);
    setReason("");
    setError("");
  };
  const openRows =
    snapshot?.ledger.rows.filter((r) =>
      ["proposed", "prepared"].includes(r.state),
    ) || [];

  const fieldLabel = (field: string) =>
    ({
      id: "Record ID",
      effective_at: "Event time (UTC)",
      known_at: "Time first known (UTC)",
      customer_id: "Customer ID",
      advance_id: "Advance ID",
      invoice_ref: "Invoice reference",
      payout_at: "Planned payout time (UTC)",
      due_at: "Repayment due time (UTC)",
      credit_limit: "Customer credit limit",
      snapshot_id: "Cash snapshot ID",
    })[field] || words(field);
  const suggestedMapping = (nextKind: ImportKind, nextHeaders: string[]) =>
    Object.fromEntries(
      (snapshot?.columns[nextKind] || []).map((field) => {
        const saved = snapshot?.data.mappings[nextKind]?.[field];
        return [
          field,
          saved && nextHeaders.includes(saved)
            ? saved
            : nextHeaders.find(
                (header) => header.replace(/^\uFEFF/, "") === field,
              ) || "",
        ];
      }),
    );
  async function chooseFile(selectedFile: File | null) {
    const generation = ++fileGeneration.current;
    setFile(null);
    setHeaders([]);
    setImportText("");
    setMapping({});
    setError("");
    if (!selectedFile) return;
    if (selectedFile.size > 2_000_000) {
      setError("Split the file into files smaller than 2 MB.");
      return;
    }
    try {
      const decoded = decodeUtf8(
        new Uint8Array(await selectedFile.arrayBuffer()),
      );
      if (generation !== fileGeneration.current) return;
      if (decoded.error || decoded.text === undefined)
        throw Error(decoded.error || "This file could not be read.");
      // Keep the original UTF-8 BOM in retained source text and its mapped header.
      const text = `${decoded.bom ? "\uFEFF" : ""}${decoded.text}`;
      const parsed = parseCsv(text);
      if (parsed.fileErrors.length || parsed.recordErrors.length)
        throw Error(
          [
            ...parsed.fileErrors,
            ...parsed.recordErrors.map((e) => `Row ${e.line}: ${e.message}`),
          ].join(" "),
        );
      if (
        !parsed.header.length ||
        new Set(parsed.header).size !== parsed.header.length
      )
        throw Error("Use a CSV with distinct column headings.");
      setHeaders(parsed.header);
      setImportText(text);
      setFile(selectedFile);
      setMapping(suggestedMapping(currentKind.current, parsed.header));
    } catch (e) {
      if (generation === fileGeneration.current)
        setError(
          e instanceof Error ? e.message : "The file could not be read.",
        );
    }
  }
  function importRecords(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      setError("Choose a CSV file first.");
      return;
    }
    const fields = snapshot?.columns[kind] || [];
    if (
      !fields.length ||
      fields.some((field) => !mapping[field]) ||
      new Set(Object.values(mapping)).size !== fields.length
    ) {
      setError("Choose a different CSV column for every required field.");
      return;
    }
    send({
      action: "import",
      kind,
      text: importText,
      filename: file.name,
      mapping,
    });
  }

  return (
    <div className={styles.desk}>
      <a className={styles.skip} href="#funding-main">
        Skip to content
      </a>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span aria-hidden="true" className={styles.mark}>
            C
          </span>
          Clearline<span className={styles.product}>Funding desk</span>
        </div>
        {snapshot && (
          <div className={styles.identity}>
            <span>
              {snapshot.user.name}
              <small>{snapshot.user.role}</small>
            </span>
            <button disabled={busy} onClick={() => send({ action: "logout" })}>
              Sign out
            </button>
          </div>
        )}
      </header>
      {snapshot?.simulation && (
        <div className={styles.simulation}>
          <strong>Simulation</strong> · Synthetic records. No money moves.
          Replay time: {time(snapshot.at)}
        </div>
      )}
      <main id="funding-main" className={styles.main}>
        {error && (
          <div role="alert" className={styles.error}>
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className={styles.notice}>
            {notice}
          </div>
        )}
        {!loaded ? (
          <p role="status">Opening the funding desk…</p>
        ) : !snapshot ? (
          <section className={styles.login}>
            <p className={styles.eyebrow}>Provider workspace</p>
            <h1>Sign in to the funding desk</h1>
            <p>Review an advance. Keep track of what is still owed.</p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                send({ action: "login", email, password });
              }}
            >
              <label>
                Email
                <input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <button className={styles.primary} disabled={busy} type="submit">
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </form>
            <p className={styles.muted}>
              Your deployment administrator provides access.
            </p>
          </section>
        ) : (
          <>
            <nav aria-label="Funding desk" className={styles.tabs}>
              {(["Approvals", "Exceptions", "Settings"] as Tab[]).map(
                (item) => (
                  <button
                    key={item}
                    aria-current={
                      tab === item && !selected ? "page" : undefined
                    }
                    onClick={() => {
                      setTab(item);
                      setSelected("");
                    }}
                  >
                    {item}
                  </button>
                ),
              )}
            </nav>
            {selected && advance && row ? (
              <>
                <button className={styles.back} onClick={() => setSelected("")}>
                  ← Back to {tab.toLowerCase()}
                </button>
                <div className={styles.title}>
                  <div>
                    <p className={styles.eyebrow}>{advance.id}</p>
                    <h1>{advance.invoice_ref || "Invoice reference needed"}</h1>
                    <p>
                      {customerName(advance.customer_id)} → {advance.supplier}
                    </p>
                  </div>
                  <span className={styles.badge}>{words(row.state)}</span>
                </div>
                <div className={styles.position}>
                  <section>
                    <h2>Supplier payment</h2>
                    <strong>{money(row.paid, row.currency)}</strong>
                    <p>
                      {row.supplier_delivery === "paid"
                        ? "Supplier paid according to supplied payout records."
                        : row.supplier_delivery === "partly_paid"
                          ? "Part of the supplier payment is recorded."
                          : "Supplier credit has not been recorded."}
                    </p>
                  </section>
                  <section>
                    <h2>Still owed to the provider</h2>
                    <strong>{money(row.outstanding, row.currency)}</strong>
                    <p>Due {time(row.due_at)}</p>
                    <p>
                      Matched repayments: {money(row.repaid, row.currency)} ·
                      Written off: {money(row.written_off, row.currency)}
                    </p>
                    <p>
                      Undisbursed commitment:{" "}
                      {money(row.remaining_commitment, row.currency)}
                    </p>
                  </section>
                </div>
                <section className={styles.panel}>
                  <h2>Current advance checks</h2>
                  <p>
                    Requested:{" "}
                    <span className={styles.mono}>
                      {money(advance.amount, advance.currency)}
                    </span>{" "}
                    · Account: {advance.account}
                  </p>
                  {review ? (
                    <ul className={styles.checks}>
                      {review.checks.map((check) => (
                        <li key={check.code}>
                          <span
                            className={
                              check.status === "pass"
                                ? styles.pass
                                : styles.attention
                            }
                          >
                            {words(check.status)}
                          </span>
                          <div>
                            <strong>{words(check.code)}</strong>
                            <p>{check.reason}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>No current review is available for this advance.</p>
                  )}
                  {((operator && advance.state === "proposed") ||
                    (approver && advance.state === "prepared")) && (
                    <form
                      onSubmit={(event) => event.preventDefault()}
                      className={styles.decision}
                    >
                      <label>
                        Decision reason
                        <textarea
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          maxLength={1000}
                          placeholder="What did you check, and why are you taking this action?"
                        />
                      </label>
                      {approver &&
                        (!review ||
                          review.checks.some(
                            (check) => check.status !== "pass",
                          )) && (
                          <p className={styles.attention}>
                            Approval is unavailable until every check passes.
                            Review the reasons above; you can still record a
                            decline.
                          </p>
                        )}
                      <div className={styles.actions}>
                        {operator && (
                          <button
                            className={styles.primary}
                            disabled={busy || !reason.trim()}
                            onClick={() =>
                              send({
                                action: "prepare",
                                advance_id: selected,
                                reason,
                              })
                            }
                          >
                            Prepare advance
                          </button>
                        )}
                        {approver && (
                          <>
                            <button
                              className={styles.primary}
                              disabled={
                                busy ||
                                !reason.trim() ||
                                !review ||
                                review.checks.some(
                                  (check) => check.status !== "pass",
                                )
                              }
                              onClick={() =>
                                send({
                                  action: "approve",
                                  advance_id: selected,
                                  reason,
                                })
                              }
                            >
                              Approve advance
                            </button>
                            <button
                              disabled={busy || !reason.trim()}
                              onClick={() =>
                                send({
                                  action: "decline",
                                  advance_id: selected,
                                  reason,
                                })
                              }
                            >
                              Decline advance
                            </button>
                          </>
                        )}
                      </div>
                    </form>
                  )}
                  <p className={styles.muted}>
                    A named treasury user makes the decision. The person who
                    prepares a case cannot approve it.
                  </p>
                </section>
                {approver &&
                  row.outstanding !== "0" &&
                  row.outstanding !== "0.00" && (
                    <section className={styles.panel}>
                      <h2>Write-off</h2>
                      <p>
                        A write-off reduces the recorded debt. It is not a
                        repayment and does not restore available cash or the
                        customer’s credit limit.
                      </p>
                      <form
                        className={styles.form}
                        onSubmit={(event) => {
                          event.preventDefault();
                          const values = Object.fromEntries(
                            new FormData(event.currentTarget),
                          );
                          send({
                            action: "write_off",
                            advance_id: selected,
                            ...values,
                          });
                        }}
                      >
                        <label>
                          Write-off amount ({row.currency})
                          <input name="amount" inputMode="decimal" required />
                        </label>
                        <label>
                          Write-off reason
                          <textarea name="reason" required maxLength={1000} />
                        </label>
                        <button disabled={busy} type="submit">
                          Record write-off
                        </button>
                      </form>
                    </section>
                  )}
                <section className={styles.panel}>
                  <h2>Evidence timeline</h2>
                  <p className={styles.muted}>
                    Ordered by when evidence became known or a decision was
                    recorded. Equal timestamps use a consistent display order.
                  </p>
                  <ol
                    className={styles.timeline}
                    aria-label="Evidence timeline"
                  >
                    {[
                      ...snapshot.data.events
                        .filter((e) => e.advance_id === selected)
                        .map((e) => ({
                          at: e.at,
                          content: (
                            <li key={e.id}>
                              <time>{time(e.at)}</time>
                              <div>
                                <strong>{words(e.action)}</strong> ·{" "}
                                {snapshot.data.users.find(
                                  (u) => u.id === e.actor_id,
                                )?.name || e.actor_id}
                                <p>{e.reason}</p>
                                {e.review && (
                                  <details>
                                    <summary>Recorded checks</summary>
                                    {e.review.checks.map((check) => (
                                      <p key={check.code}>
                                        {words(check.status)} · {check.reason}
                                      </p>
                                    ))}
                                  </details>
                                )}
                              </div>
                            </li>
                          ),
                        })),
                      ...snapshot.data.payouts
                        .filter((p) => p.advance_id === selected)
                        .map((p) => ({
                          at: p.known_at,
                          content: (
                            <li key={`payout-${p.id}`}>
                              <time>{time(p.known_at)}</time>
                              <div>
                                <strong>Payout evidence</strong>
                                <p>
                                  {money(p.amount, p.currency)} · {p.reference}
                                </p>
                              </div>
                            </li>
                          ),
                        })),
                      ...snapshot.data.receipts
                        .filter((r) => {
                          const allocation = snapshot.ledger.allocations.find(
                            (a) => a.receipt_id === r.id,
                          );
                          return allocation
                            ? allocation.advance_id === selected
                            : r.customer_id === advance.customer_id &&
                                (r.reference === advance.id ||
                                  (Boolean(advance.invoice_ref) &&
                                    r.reference === advance.invoice_ref));
                        })
                        .map((r) => {
                          const allocation = snapshot.ledger.allocations.find(
                            (a) =>
                              a.receipt_id === r.id &&
                              a.advance_id === selected,
                          );
                          return {
                            at: r.known_at,
                            content: (
                              <li key={`receipt-${r.id}`}>
                                <time>{time(r.known_at)}</time>
                                <div>
                                  <strong>
                                    {allocation
                                      ? "Matched repayment"
                                      : "Unallocated receipt (not a repayment)"}
                                  </strong>
                                  <p>
                                    Received {money(r.amount, r.currency)} ·{" "}
                                    {r.reference || "No reference"}.
                                    {allocation
                                      ? ` Allocated to this advance: ${money(allocation.amount, r.currency)}.`
                                      : " The reference names this advance, but no repayment is allocated. Review the exception."}
                                  </p>
                                </div>
                              </li>
                            ),
                          };
                        }),
                    ]
                      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
                      .map((entry) => entry.content)}
                  </ol>
                  <p className={styles.muted}>
                    Full source files may include other supplied records. Review
                    the pack before sharing outside your organisation.
                  </p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      exportFile("evidence", "evidence.zip", selected)
                    }
                  >
                    Evidence pack
                  </button>
                </section>
              </>
            ) : tab === "Approvals" ? (
              <>
                <div className={styles.title}>
                  <div>
                    <p className={styles.eyebrow}>At the cutoff</p>
                    <h1>Advance approvals</h1>
                    <p>
                      Prepare the evidence. Treasury decides whether to advance
                      the money.
                    </p>
                  </div>
                  <span className={styles.badge}>
                    {openRows.length} awaiting action
                  </span>
                </div>
                {!openRows.length && (
                  <div className={styles.empty}>
                    <h2>Nothing needs you today</h2>
                    <p>
                      No advance is waiting for preparation or approval in the
                      supplied records.
                    </p>
                  </div>
                )}
                <div className={styles.cards}>
                  {openRows.map((r) => (
                    <article className={styles.card} key={r.advance_id}>
                      <div>
                        <span className={styles.badge}>{words(r.state)}</span>
                        <h2>{customerName(r.customer_id)}</h2>
                        <p>
                          {r.invoice_ref} · {r.advance_id}
                        </p>
                      </div>
                      <strong className={styles.mono}>
                        {money(
                          snapshot.data.advances.find(
                            (a) => a.id === r.advance_id,
                          )?.amount || "0",
                          r.currency,
                        )}
                      </strong>
                      <button onClick={() => open(r.advance_id)}>
                        Open {r.advance_id}
                      </button>
                    </article>
                  ))}
                </div>
                <details className={styles.panel}>
                  <summary>All supplied advances</summary>
                  <div className={styles.cards}>
                    {snapshot.ledger.rows.map((r) => (
                      <article key={r.advance_id} className={styles.card}>
                        <div>
                          <strong>{r.invoice_ref || r.advance_id}</strong>
                          <p>
                            {words(r.state)} · {customerName(r.customer_id)}
                          </p>
                        </div>
                        <button onClick={() => open(r.advance_id)}>
                          Open {r.advance_id}
                        </button>
                      </article>
                    ))}
                  </div>
                </details>
              </>
            ) : tab === "Exceptions" ? (
              <>
                <div className={styles.title}>
                  <div>
                    <p className={styles.eyebrow}>After payout</p>
                    <h1>What needs attention</h1>
                    <p>Only exceptions from the supplied records.</p>
                  </div>
                  <span className={styles.badge}>
                    {snapshot.ledger.exceptions.length} exceptions
                  </span>
                </div>
                {!snapshot.ledger.exceptions.length ? (
                  <div className={styles.empty}>
                    <h2>Nothing needs you today</h2>
                    <p>All clear in the supplied records.</p>
                  </div>
                ) : (
                  <div className={styles.cards}>
                    {snapshot.ledger.exceptions.map((e, i) => (
                      <article
                        className={styles.card}
                        key={`${e.code}-${e.advance_id}-${e.receipt_id}-${i}`}
                      >
                        <div>
                          <span className={styles.attention}>
                            {words(e.code)}
                          </span>
                          <h2>{e.advance_id || e.receipt_id}</h2>
                          <p>{e.reason}</p>
                        </div>
                        <strong className={styles.mono}>
                          {money(e.amount, e.currency)}
                        </strong>
                        {e.advance_id && (
                          <button onClick={() => open(e.advance_id)}>
                            Open {e.advance_id}
                          </button>
                        )}
                      </article>
                    ))}
                  </div>
                )}
                <section className={styles.panel}>
                  <h2>Daily digest</h2>
                  <pre className={styles.digest}>{snapshot.digest}</pre>
                </section>
              </>
            ) : (
              <>
                <div className={styles.title}>
                  <div>
                    <p className={styles.eyebrow}>Your existing files</p>
                    <h1>Workspace settings</h1>
                    <p>
                      Map your exports once. Keep the evidence in your
                      deployment.
                    </p>
                  </div>
                </div>
                <section className={styles.panel}>
                  <h2>Import records</h2>
                  <p>
                    Supply customers and agreed terms, advances, cash
                    classifications, payouts or bank receipts.
                  </p>
                  {operator ? (
                    <form onSubmit={importRecords} className={styles.form}>
                      <label>
                        Import type
                        <select
                          value={kind}
                          onChange={(e) => {
                            const k = e.target.value as ImportKind;
                            currentKind.current = k;
                            setKind(k);
                            setMapping(suggestedMapping(k, headers));
                          }}
                        >
                          {kinds.map((k) => (
                            <option key={k} value={k}>
                              {words(k)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        CSV file
                        <input
                          type="file"
                          accept=".csv,text/csv"
                          onChange={(e) =>
                            chooseFile(e.target.files?.[0] || null)
                          }
                        />
                      </label>
                      {file && (
                        <fieldset className={styles.mapping}>
                          <legend>Match your columns</legend>
                          <p>
                            Choose the column in your file for each field. Saved
                            matches are filled in when the headings are the
                            same.
                          </p>
                          <div className={styles.fields}>
                            {snapshot.columns[kind].map((field) => (
                              <label key={field}>
                                CSV column for {fieldLabel(field)}
                                <select
                                  required
                                  value={mapping[field] || ""}
                                  onChange={(e) =>
                                    setMapping((previous) => ({
                                      ...previous,
                                      [field]: e.target.value,
                                    }))
                                  }
                                >
                                  <option value="">Choose a column</option>
                                  {headers.map((header) => (
                                    <option key={header} value={header}>
                                      {header}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            ))}
                          </div>
                        </fieldset>
                      )}
                      <p className={styles.muted}>
                        Mappings are saved with each successful import. A
                        rejected file leaves the current records unchanged.
                      </p>
                      <button
                        className={styles.primary}
                        type="submit"
                        disabled={busy || !file}
                      >
                        Import records
                      </button>
                    </form>
                  ) : (
                    <p className={styles.muted}>
                      An operator imports records and updates classifications.
                    </p>
                  )}
                  <details>
                    <summary>Saved column mappings</summary>
                    {Object.entries(snapshot.data.mappings).length ? (
                      Object.entries(snapshot.data.mappings).map(
                        ([savedKind, savedMapping]) => (
                          <section key={savedKind}>
                            <h3>{words(savedKind)}</h3>
                            <dl className={styles.savedMappings}>
                              {Object.entries(savedMapping || {}).map(
                                ([field, column]) => (
                                  <div key={field}>
                                    <dt>{fieldLabel(field)}</dt>
                                    <dd>{column}</dd>
                                  </div>
                                ),
                              )}
                            </dl>
                          </section>
                        ),
                      )
                    ) : (
                      <p>
                        No mappings saved yet. Import a file to save its column
                        choices.
                      </p>
                    )}
                  </details>
                </section>
                <section className={styles.panel}>
                  <h2>Free cash classification</h2>
                  <p>
                    Account balance less safeguarded customer money, pending
                    payouts and buffer. Undrawn credit lines are not cash.
                  </p>
                  <p className={styles.attention}>
                    Provider classification · confirm with your counsel.
                  </p>
                  {operator && (
                    <form
                      className={styles.form}
                      onSubmit={(event) => {
                        event.preventDefault();
                        const values = Object.fromEntries(
                          new FormData(event.currentTarget),
                        );
                        send({ action: "cash", ...values });
                      }}
                    >
                      <div className={styles.fields}>
                        <label>
                          Account
                          <input
                            name="account"
                            required
                            defaultValue={
                              snapshot.data.advances[0]?.account || ""
                            }
                          />
                        </label>
                        <label>
                          Currency
                          <select name="currency">
                            <option>SGD</option>
                            <option>USD</option>
                          </select>
                        </label>
                        <label>
                          Account balance
                          <input name="balance" inputMode="decimal" required />
                        </label>
                        <label>
                          When was this bank balance observed? (UTC)
                          <input
                            name="effective_at"
                            required
                            placeholder="2026-11-09T09:00:00Z"
                          />
                        </label>
                        <label>
                          Safeguarded customer money
                          <input
                            name="safeguarded"
                            inputMode="decimal"
                            required
                            defaultValue="0"
                          />
                        </label>
                        <label>
                          Pending payouts
                          <input
                            name="pending"
                            inputMode="decimal"
                            required
                            defaultValue="0"
                          />
                        </label>
                        <label>
                          Buffer
                          <input
                            name="buffer"
                            inputMode="decimal"
                            required
                            defaultValue="0"
                          />
                        </label>
                      </div>
                      <button disabled={busy} type="submit">
                        Record cash snapshot
                      </button>
                    </form>
                  )}
                  <p className={styles.muted}>
                    Use the observation time from the bank evidence. Changing
                    classifications does not make an old balance fresh. The desk
                    records when you supplied this snapshot and keeps the
                    earlier evidence. Pending amounts and local reservations are
                    deducted conservatively until reconciled.
                  </p>
                </section>
                <section className={styles.panel}>
                  <h2>Users and roles</h2>
                  <p>
                    Access is managed by your deployment administrator through
                    the local setup command.
                  </p>
                  <ul className={styles.users}>
                    {snapshot.data.users.map((u) => (
                      <li key={u.id}>
                        <strong>{u.name}</strong>
                        <span>{u.role}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              </>
            )}
            <section className={styles.exports}>
              <div>
                <h2>Files for your existing tools</h2>
                <p>Review before import. Nothing is sent automatically.</p>
              </div>
              <div className={styles.actions}>
                {[
                  ["open-csv", "Open advances CSV", "open-advances.csv"],
                  ["open-xlsx", "Open advances XLSX", "open-advances.xlsx"],
                  ["exceptions", "Exceptions CSV", "exceptions.csv"],
                  ["digest", "Daily digest", "digest.txt"],
                ].map(([format, label, filename]) => (
                  <button
                    key={format}
                    disabled={busy}
                    onClick={() => exportFile(format, filename)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <details>
                <summary>Accounting and feed formats</summary>
                <p className={styles.muted}>
                  Journal files are cumulative snapshots, not incremental
                  postings. They require provider-confirmed account mappings and
                  controller review. Re-importing a file may duplicate entries;
                  reconcile against previous imports first.
                </p>
                <div className={styles.actions}>
                  {[
                    ["journals", "Generic journals", "journals.csv"],
                    ["xero", "Xero journal file", "xero.csv"],
                    ["netsuite", "NetSuite journal file", "netsuite.csv"],
                    ["slack", "Slack-formatted digest", "slack.txt"],
                    ["webhook", "JSON digest", "digest.json"],
                  ].map(([format, label, filename]) => (
                    <button
                      key={format}
                      disabled={busy}
                      onClick={() => exportFile(format, filename)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </details>
            </section>
            {snapshot.simulation && (
              <section className={styles.simControls}>
                <h2>Simulation controls</h2>
                <p>
                  These actions record synthetic evidence. They do not instruct
                  a payout or transfer money.
                </p>
                {operator && (
                  <>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        send({ action: "clock", at: clock });
                      }}
                    >
                      <label>
                        Replay time (UTC)
                        <input
                          value={clock}
                          onChange={(e) => setClock(e.target.value)}
                        />
                      </label>
                      <button disabled={busy} type="submit">
                        Set replay time
                      </button>
                    </form>
                    <div className={styles.actions}>
                      <button
                        disabled={busy}
                        onClick={() =>
                          send({
                            action: "sample-payout",
                            advance_id:
                              selected || snapshot.data.advances[0]?.id,
                          })
                        }
                      >
                        Record sample payout
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          send({
                            action: "sample-receipt",
                            advance_id:
                              selected || snapshot.data.advances[0]?.id,
                          })
                        }
                      >
                        Record sample receipt
                      </button>
                    </div>
                  </>
                )}
              </section>
            )}
            <footer className={styles.footer}>
              Records as of {time(snapshot.at)} · No custody. No money movement.
              Treasury owns the decision.
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
