"use client";
import { useState } from "react";
import type { Settings, Token } from "@/lib/types";
import { DEPOSIT_CHAINS, CHAIN_NAMES } from "@/lib/types";
export function RuleSettings({
  initial,
  demo,
}: {
  initial: Settings;
  demo: boolean;
}) {
  const [s, setS] = useState(initial),
    [status, setStatus] = useState("");
  async function save() {
    const r = await fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(s),
    });
    const b = await r.json();
    if (r.ok) {
      setS(b);
      setStatus(
        "New settings version saved. Existing evidence snapshots keep their original version.",
      );
    } else setStatus(b.error);
  }
  return (
    <section className="panel" style={{ padding: 24 }}>
      <div className="section-heading">
        <h2>Company deposit policy</h2>
        <span className="badge">
          {demo ? "Demo policy" : "Admin controlled"}
        </span>
      </div>
      <p className="muted">
        Declare the contracts you accept. Empty contract means unsupported. BNB
        contracts are company declarations, not issuer endorsements.
      </p>
      {DEPOSIT_CHAINS.map((c) => (
        <fieldset key={c} className="policy-fieldset">
          <legend>{CHAIN_NAMES[c]}</legend>
          <label>
            Confirmations{" "}
            <input
              className="input"
              type="number"
              min="1"
              value={s.confirmations[c]}
              onChange={(e) =>
                setS({
                  ...s,
                  confirmations: {
                    ...s.confirmations,
                    [c]: Number(e.target.value),
                  },
                })
              }
            />
          </label>
          {(["USDT", "USDC"] as Token[]).map((t) => (
            <div className="form-grid" key={t}>
              <label>
                {t} contract
                <input
                  className="input mono"
                  value={
                    s.acceptedTokens[c].find((a) => a.symbol === t)?.contract ??
                    ""
                  }
                  onChange={(e) =>
                    setS({
                      ...s,
                      acceptedTokens: {
                        ...s.acceptedTokens,
                        [c]: [
                          ...s.acceptedTokens[c].filter((a) => a.symbol !== t),
                          ...(e.target.value
                            ? [{ symbol: t, contract: e.target.value }]
                            : []),
                        ],
                      },
                    })
                  }
                />
              </label>
              <label>
                Minimum {t}
                <input
                  className="input mono"
                  value={s.minimums[c][t] ?? ""}
                  onChange={(e) =>
                    setS({
                      ...s,
                      minimums: {
                        ...s.minimums,
                        [c]: { ...s.minimums[c], [t]: e.target.value },
                      },
                    })
                  }
                />
              </label>
            </div>
          ))}
        </fieldset>
      ))}
      {(
        ["belowMinimumPolicy", "retiredAddressPolicy", "whereInApp"] as const
      ).map((k) => (
        <label className="stack-label" key={k}>
          {
            {
              belowMinimumPolicy: "Below-minimum policy",
              retiredAddressPolicy: "Retired-address policy",
              whereInApp: "Where credits appear",
            }[k]
          }
          <input
            className="input"
            value={s[k]}
            onChange={(e) => setS({ ...s, [k]: e.target.value })}
          />
        </label>
      ))}
      <label>
        <input
          type="checkbox"
          checked={s.keysHeldOnOtherChains}
          onChange={(e) =>
            setS({ ...s, keysHeldOnOtherChains: e.target.checked })
          }
        />{" "}
        Company controls corresponding addresses on other EVM chains
      </label>
      <div className="form-row" style={{ marginTop: 20 }}>
        <button className="btn primary" disabled={demo} onClick={save}>
          Save new policy version
        </button>
        <span role="status" className="muted">
          {status ||
            (demo
              ? "Demo policies cannot change live settings."
              : "Changes apply to new investigations only.")}
        </span>
      </div>
    </section>
  );
}
