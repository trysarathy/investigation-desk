# Clearline — product strategy, unified architecture and build decisions (rc4, 15 Nov 2026)

Owner: tech-lead-architect with product-manager (build session). Sources: `docs/research/PAYMENTS_AND_STABLECOIN.md`
(source IDs such as `[MT3]` resolve in its register), `docs/research/ACCOUNTING_SYSTEMS_AND_RILLET.md`,
`docs/research/GLOBAL_MARKETS.md`, `docs/research/CUSTOMER_VALIDATION_PLAN.md`. Labels follow
`company/COMPANY_RULES.md` rule 2; this document adds `[INFERENCE]` for reasoning from those sources.

**Stage.** Clearline is a fictional-data sandbox with **0 customers**. Nothing here is a claim of product-market fit,
partnership or demand. The research found **no demand evidence** for or against Clearline; that is what the validation
plan is for.

## 1. Differentiation thesis — what the evidence supports

**Hypothesis under test:** Clearline can provide a consistent, independent financial history across payment providers,
settlement evidence and accounting systems.

**What the vendors' own documentation supports** (verified from primary pages):
- Provider "done" is a claim. Nine of fourteen payment/stablecoin vendors document a completion status that can regress
  or that does not prove funds arrived (Stripe `paid→failed`, Modern Treasury "completed does not imply
  reconciliation", Airwallex `PAID→FAILED`, Nium time-inferred `DEEMED_PAID`, Circle CPN "may or may not have received",
  Bridge preliminary hash, Zero Hash internal `CONFIRMED`, BitGo ledger events, Fireblocks "independent check").
- Accounting systems reconcile by rules that include amount-and-date matching (NetSuite's system rules, Intacct rule
  sets) and some treat a provider balance as a bank account (Rillet's cash reconciliation includes the Stripe balance).
- Every accounting vendor gates posting behind a person or a configured rule; none documents AI as the authority on
  evidence.

**What already exists** (so Clearline must not claim it): separate reconciliation/settlement fields inside a single
provider (Modern Treasury, Gr4vy, Nium, Zero Hash); cross-source balance reconciliation with connectors and a ledger
(Formance); unified card-PSP settlement (Primer, Gr4vy); bank reconciliation with approvals and ledgers (Modern
Treasury); crypto sub-ledgers that push reviewed journals to ERPs (Cryptio, Cryptoworth).

**The plausible gap** `[INFERENCE]`: no opened source documents one product that, per payment, keeps provider claims,
independent bank evidence and on-chain evidence apart **across providers**, and carries the result to a
person-approved accounting outcome. That gap matters for **multi-rail** operators (several payout providers + banks +
stablecoin rails). It is **narrow** for single-provider, card-only and Modern-Treasury-centred teams.

**Verdict: not proven.** Clearline's design is consistent with how vendors describe their own states; whether buyers
pay for a separate cross-provider evidence layer is unknown. The thesis is tested by the validation plan's
pre-registered thresholds (confirm ≥5 of 8 "strong"; kill ≤2 of 8, or ≥6 "existing tools cover it").

## 2. Unified product architecture

One record per payment, one evidence model, three capabilities:

```
Intent → Route → Execution report → Evidence → Reconciliation → Exception → Resolution → Accounting outcome
 └──────── Connect ────────┘ └──────────────────── Control ─────────────────────┘ └─ Accounting Bridge ─┘
```

| Capability | Owns | Never does |
|---|---|---|
| **Connect** | intents, quotes, route eligibility, maker-checker instruction, provider adapters (raw status kept verbatim, mapped to a *claim* with confidence; regressions are contradictions; pluggable webhook verification; ordering independent of arrival; polling), idempotency | execute live payouts in the sandbox; treat a provider status as settlement |
| **Control** | settlement evidence (bank statement lines, chain observations), reconciliation by trusted reference, exceptions with owners, holds, liquidity, Funding exposure (Funding Desk), investigation, case reports, audit | allocate by amount alone; let a provider report count as independent evidence |
| **Accounting Bridge** | accounting-ready export of evidenced movements, proposed balanced journal entries traced to evidence + rule, CoA mapping by posting role, periods, maker-checker approval, export idempotency, a person-recorded posting reference | post to any external ledger; create an entry without evidence; be an ERP or general ledger |

**Evidence classes** (one vocabulary across the product): *independent* = bank statement line, Clearline's own chain
observation; *provider report* = provider settlement reports, provider statements, provider-ledger "confirmed"; *claim*
= provider event status. Only independent evidence can make settlement verified or support a proposed entry.

**Financial invariants** (enforced in the engine; table with file:function and tests in
`docs/clearline/ARCHITECTURE.md` §4 and the Accounting Bridge section): exact integer arithmetic; immutable source
evidence separate from derived conclusions; three independent states; reference-based attribution only; returns keep
the beneficiary unpaid; stablecoin identity/chain/token/contract/recipient/amount/finality/reorg; funding 50,000 /
30,000 / 20,000 with unrelated receipts never closing it; every conclusion traceable to evidence and rule; explicit
actors with maker ≠ checker; no automatic posting; simulated roles are not authentication.

## 3. Build decisions (research-to-build framework)

| Feature | Customer problem | Evidence / competitor reference | Decision |
|---|---|---|---|
| Accounting-ready reconciliation export | finance must carry payment outcomes into the ledger | every ERP imports CSV journals; Cryptio/Cryptoworth sync reviewed journals | **BUILD NOW** (rc4) |
| Proposed journal entries (balanced, evidence-traced, never auto-posted) | manual journal preparation after reconciliation | Intacct/NetSuite/Zoho draft→approve flows; Rillet posts via API directly, so the gate must be ours | **BUILD NOW** (rc4) |
| CoA mapping by posting role; periods; maker-checker; export idempotency owned by Clearline | entries must land in the customer's accounts, in open periods, once | Rillet idempotency keys last 24 h only; NetSuite external-ID upsert | **BUILD NOW** (rc4) |
| Connect adapter framework (raw status, regression as contradiction, webhook schemes, ordering, polling) | provider statuses regress; webhooks are at-most-once | 9/14 vendors document non-final completion; Nium at-most-once; Thunes poll fallback | **BUILD NOW** (rc4, sandbox, fictional providers) |
| First live accounting adapter (Xero draft manual journals, then NetSuite external-ID upsert) | removes file handling | Xero already chosen in PRODUCT_FACTS; NetSuite skips approval for imported records, so status must be set explicitly | **BUILD NEXT** — needs sandbox credentials, tests and founder approval |
| Tally XML voucher file | India SMEs/exporters on Tally | TallyPrime XML over local port; tunnel option documented | **BUILD NEXT** (file export only) after India validation |
| Real provider adapters / live execution | — | regulatory and partner dependencies | **RESEARCH FIRST** — separate authorisation, integrations, regulatory review |
| Bank statement ingestion (CAMT.053/BAI2/MT940) from real banks | independent evidence needs statement access | Formance statement ingestion still closed beta; Circle CAMT daily | **BUILD NEXT** (parser for sandbox files first) |
| FX quote normalisation | comparing routes | Thunes, Airwallex, CPN, Nium quote shapes | **BUILD NEXT** |
| AI investigation summaries, provider-question drafts, CoA-mapping suggestions | reduce manual investigation writing | vendors keep AI as assistant; NetSuite marks AI-assisted matches | **BUILD NEXT** behind the guard in §4 (needs an approved model provider and keys; none in the sandbox) |
| General ledger / ERP | — | Formance, MT Ledgers, Rillet are mature | **DO NOT BUILD** |
| Auto-posting to any ledger | — | contradicts the product's trust position | **DO NOT BUILD** |
| Amount-only auto-matching | — | the source of the problem Clearline exists to avoid | **DO NOT BUILD** (amount-only candidates may only be *suggested* to a person) |

## 4. The AI intelligence layer (design; not implemented in rc4)

AI assists; deterministic logic and people decide. Allowed outputs, each grounded only in engine data:
investigation summaries, exception-classification *suggestions*, evidence explanations, drafts of provider questions
and customer replies, explanations of reconciliation differences, next-step suggestions, CSV field-mapping suggestions,
summaries of unresolved cases.

**Guard (to be enforced in code when built):**
1. The model receives only the engine's view for that case; it never receives credentials.
2. Every amount, reference, id, date and status in the output must appear verbatim in the supplied engine view;
   otherwise the output is rejected (not "corrected").
3. Output is text for a person to read or edit. It can never call `applyAction`, set evidence, amounts, entries,
   approvals, finality or closure. Suggestions become actions only when a person performs the normal, engine-gated
   action.
4. Every generated text is stored with model id, prompt hash and the engine view hash, and is labelled
   "AI-drafted — check against the evidence".
5. Off by default; enabled per workspace by the founder after a separate review.

## 5. Market strategy (summary of `GLOBAL_MARKETS.md`)

Scores are `[GUESS]` with weights shown in the report. **Test first:** payment-operations and finance-operations leads at
Singapore major payment institutions doing cross-border money transfer with two or more payout providers or rails,
plus a capped comparison cell of Singapore exporters and marketplaces. Singapore wins on speed of learning for a
Singapore-based founder, not on size; with accessibility weighted to zero, the US and UK lead. **India** is a serious
second candidate (PA-CB framework — RBI lists 37 PA-CB authorisations by the researcher's count; export realisation nine
months; payment-data localisation reaches vendors; Tally dominates and has no REST API; VDA tax 30% + 1% TDS), but
localisation and Tally integration raise the cost of a first pilot there. What would change the call is in §4 of the
report.

Open founder decisions surfaced by the research: **D1** beachhead (S5 payment providers/remitters vs the earlier Web3
SaaS-on-Xero hypothesis); pricing for this buyer (the US$300 pilot was set for the stablecoin product);
whether `company/PRODUCT_FACTS.md` and `AGENTS.md` should be updated to the Connect + Control + Accounting Bridge
direction (governance change — needs her approval).
