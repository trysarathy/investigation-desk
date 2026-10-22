"use client";
import { useState } from "react";
import type { Aggregate } from "@/lib/intelligence/signals";
export function Intelligence({
  initial,
}: {
  initial: { enabled: boolean; aggregates: Aggregate[] };
}) {
  const [state, setState] = useState(initial),
    [error, setError] = useState("");
  async function consent() {
    try {
      const r = await fetch("/api/intelligence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !state.enabled }),
      });
      const b = await r.json();
      if (!r.ok) throw Error(b.error);
      setState(b);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">Shared signals, private evidence</span>
          <h1 className="display-title">Network intelligence</h1>
          <p className="muted">
            Coarse patterns only. Your cases and customer records remain in your
            workspace.
          </p>
        </div>
        <span className="badge">
          {state.enabled ? "Opted in" : "Off by default"}
        </span>
      </div>
      <section className="panel padded">
        <div className="section-heading">
          <div>
            <h2>Participation is your choice</h2>
            <p className="muted">
              Share only day, network and a reviewed pattern category. No
              hashes, addresses, amounts, customer references or raw text.
            </p>
          </div>
          <button className="btn" onClick={consent}>
            {state.enabled
              ? "Opt out and remove contributions"
              : "Opt in to shared patterns"}
          </button>
        </div>
        <p className="muted">
          Signals appear only after at least three other opted-in workspaces
          report the same category that day. Counts are not independent
          verification and never decide a diagnosis.
        </p>
        <p role="alert">{error}</p>
      </section>
      <section className="panel padded" style={{ marginTop: 24 }}>
        <h2>Observed across the network</h2>
        {state.aggregates.length ? (
          state.aggregates.map((a) => (
            <div className="search-result" key={a.pattern + a.chain}>
              <strong>
                {a.otherCompanies} other companies reported{" "}
                {a.pattern.replaceAll("_", " ")} today
              </strong>
              <span className="muted">
                {a.chain} · {a.day} · Unverified aggregate signal
              </span>
            </div>
          ))
        ) : (
          <div className="empty-note">
            <h2>No eligible shared signals</h2>
            <p>
              No customer network has been connected. We never populate this
              with invented companies.
            </p>
          </div>
        )}
      </section>
      <section className="panel padded" style={{ marginTop: 24 }}>
        <h2>Deliberately excluded</h2>
        <p className="muted">
          No shared private wallet blacklist. An address allegation can expose a
          company relationship and is not proof of a scam. A future public
          incident feed needs independently sourced evidence, review and
          retraction support.
        </p>
        <p className="muted">
          This build implements the consent and aggregation boundary. It does
          not run a cross-company federation or claim formal anonymisation
          guarantees against auxiliary data.
        </p>
      </section>
    </div>
  );
}
