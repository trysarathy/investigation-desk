# Task 7: ADR 0003 and its Approval Queue row

What I would commit on branch `docs/adr-0003-scenario-source`, as
`docs/adr/0003-scenario-payments-are-replayed-real-public-transfers.md`, via a docs PR. The next
free number after 0001 and 0002 in `docs/adr/` is 0003.

---

```markdown
# 3. The 20 demo payments are replayed real public transfers, labelled as such; no testnet for the 14 days

Date: 2026-11-02 (SGT)

## Status
**Proposed** (tech-lead-architect). The scenario source is Aashmiin's choice (PLAN_14_DAY "What
Aashmiin needs to do", Day 2), so it becomes Accepted only when she approves it in the Approval
Queue. Not approval-only by OPERATING_MODEL §2 category: no keys, posting rules or money amounts
change. It goes to her because it decides what the demo claims to show and how much of her time it
takes. It is easy to reverse before Day 7 and harder after (the fixtures are built on it).
Approval Queue row: "ADR 0003: scenario source for the 20 test payments".

## Context
- **Target item 2** (`docs/PLAN_14_DAY.md`): 20 test payments arrive "on testnet or as replayed
  real transfers". The catalogue (PR #53, D2.3) needs: exact ×4, partial ×3 (one accepted short),
  over ×2, duplicate ×1, wrong token/counterfeit ×2, wrong network ×2, look-alike sender address
  ×2, no reference ×2, still confirming ×1, failed ×1.
- **What exists** [VERIFIED: tech-lead-architect, read-only checkout of `origin/main` @ `0c7d9f1`,
  opened this run]:
  - `tests/fixtures/real/` holds **58** recordings of real public transactions: ETH-01..08,
    BSC-01..06, TRN-01..12, FAIL-E1..E3, FAIL-B1, FAIL-T1..T3, FAKE-01..06 and FAKE-HG,
    POISON-1/2, NET-ARB/BAS/POL, FRZ-* (10), NF-1/2 (case meaning taken from file names only;
    each one is checked before it is used). Each has `recordedAt` and the
    request/response `exchanges`.
  - `OFFLINE_REPLAY_DIR` answers chain lookups from these files with no network, and "a request
    that wasn't recorded fails … nothing is guessed" (`src/lib/chain/live.ts:38-54`).
  - `scripts/record-live.ts` records new cases using read-only chain API keys from the environment,
    redacts the keys from URLs, and refuses to write a file containing a key.
  - No testnet is configured in `src/` (grep for sepolia/nile/shasta/testnet: no hits).
  - Payment requests are Ethereum-only (`src/lib/requests/check.ts:74`). A transfer found on
    another chain records nothing today (`src/lib/requests/provider.ts:83`, gap K5; fix planned as
    D6.2).
- **Testnet facts.** "Circle runs a testnet USDC faucet on Sepolia" [ASSUMPTION: secondary, a 2025
  Medium tutorial relayed by crypto-protocol-engineer 2026-11-02; Circle's own docs page did not
  open]. The official testnet USDC contract address is **not verified**: it must come from the
  issuer's own page, which nobody has opened.
- **What a testnet run would need** (crypto-protocol-engineer, 2026-11-02): Sepolia added as a
  chain (chain id, RPC, explorer: a new network, so an ADR and code in `chain/`); the issuer's
  testnet USDC contract; a funded test wallet; and a person to send each payment. The counterfeit
  and look-alike cases also need a fake token contract deployed and a near-match address generated:
  both need **signed transactions**. Agents never sign or hold keys (company rule 3; role
  never-list). So every one of those transactions would be Aashmiin's own work, with a wallet she
  controls.
- **Constraint from Aashmiin** (Decisions log 2026-11-01): "I want the demo to be honest. I don't
  want to spend more than an hour of my own time on test wallets."
- **Honesty constraint.** Replaying a real transfer means the demo invoice's receiving address is
  set to the real recipient of a public transfer. Clearline never received that money, and the
  recipient is not a Clearline customer (0 customers, PRODUCT_FACTS).

### Options considered
1. **Do nothing** (keep only the 7 simulated demo cases in `requests/demo.ts`). Loses: it doesn't
   meet target 2 (which needs testnet or replayed real transfers), and it never exercises real
   chain responses.
2. **Testnet (Sepolia).** For: payments really "arrive" while you watch. Loses: it adds a network
   and code that isn't in the product (payment pages are Ethereum mainnet only), and an unverified
   contract source. It needs about 20 signed sends plus a fake-token deployment by Aashmiin, well
   past her one-hour limit [GUESS: ~2-4 h including faucet waits]. It adds ~3-4 tasks
   (`dependency-map-14-day.md`). And testnet tokens don't show real-world failure modes (real
   address poisoning, real counterfeit USDT).
3. **Replayed real public transfers via recorded exchanges** (chosen). For: no keys, no wallet, no
   new chain, no signing. It uses the existing replay path and the real chain shapes, including
   real poisoning and counterfeit cases. Costs Aashmiin **0 minutes** of wallet time. Against: the
   money never "arrives" live, and invoices must be addressed to strangers' public addresses, so
   it has to be labelled clearly.
4. **Synthetic for everything** (`synthHex` addresses, simulated transfers). Loses: the same
   problem as option 1 for target 2.

## Decision
We will build the 20 scenario payments as **replayed real public transfers** from recorded
chain exchanges, and add **no testnet** during the 14 days.

1. **Source per case.** Each payment is one recorded real transaction, served by
   `OFFLINE_REPLAY_DIR`. Existing recordings are reused where they fit (ETH-* for exact, partial,
   over and duplicate, by setting the fictional invoice amount around the real transfer amount;
   FAKE-* for counterfeit / wrong token; POISON-* for look-alike sender; BSC-*/NET-* for wrong
   network; FAIL-E* for failed). crypto-protocol-engineer records any missing ones with
   `scripts/record-live.ts` (read-only calls, keys redacted).
   "Still confirming" is a real Ethereum transfer **recorded within minutes of its block**, so the
   recorded block head really shows fewer confirmations than the threshold. Nothing is edited to
   fake a confirmation count.
2. **Invoices are fictional demo data.** Invoice numbers, customer names and amounts are invented
   and labelled "Demo data". The receiving address is set to the real recipient of the replayed
   transfer.
3. **Provenance on every fixture and every screen.** Fixture field `provenance: "replayed-real"`
   (only when every exchange comes from a recording of a real chain), `"synthetic"` (anything
   built with `synthHex` or edited by hand), or `"testnet"` (unused for now). The UI and
   `docs/DEMO.md` show: "Replayed public transfer: Clearline did not receive this money; the
   invoice and customer are fictional and the invoice's address was set to match it." A
   synthetic case is shown as "Demo data (synthetic)" and **does not count** toward the 20 for
   target 2. The scenario runner refuses a `replayed-real` fixture whose exchanges aren't from a
   recording.
4. **Fixture format** (`docs/ARCHITECTURE.md` §2):
   `{id, label, provenance, expected: {state, planStatus, reasonIncludes}, exchanges[]}`. Transfers
   enter as `TransferEvent` exactly as `LiveHashProvider` produces them (`source: "live"`, real
   `blockTime`). No new fields; no change to attribution or `ProblemKind`.
5. **Posting replayed transfers only to demo books or the Xero Demo Company.** A replayed scenario
   must never be posted to a real customer's books. The D11.1 run uses the Xero Demo Company only,
   and its result file says so.
6. **No public data beyond what's on chain.** Show only what the recording contains (addresses,
   hashes, amounts). Don't attach a real-world identity to any address.
7. **PRs** (each < 300 changed lines; basis: about 21 lines per fixture, runner about 84):
   (a) matching-engine-engineer: scenario runner + s01-s06 (~210);
   (b) matching-engine-engineer: s07-s13 (~150);
   (c) matching-engine-engineer: s14-s20 (~150);
   (d) crypto-protocol-engineer: new recordings for cases not already covered (still confirming;
   any second wrong-network or partial), one recording per file (~size of the JSON; split if > 250);
   (e) frontend-product-engineer + lead-designer: the provenance banner on request, payment and
   exceptions views (~80).
   Wrong-network cases depend on D6.2 (record and flag a non-Ethereum transfer instead of dropping
   it). Until D6.2 merges, those two cases are expected to show "Found on BNB Chain, not
   Ethereum", and the runner asserts that.
8. If Aashmiin later wants payments arriving live in front of a viewer, a testnet gets its own ADR
   (a new network, the issuer's contract opened at the source, and her own wallet and sends). It is
   not part of this decision.

## Consequences
- **Easier:** no keys, wallets or signing anywhere in the plan; no new chain; Aashmiin's wallet
  time is 0 minutes. Fixtures are deterministic and run offline in CI and at `demo:check` (D10.1).
  The demo shows real poisoning and counterfeit transfers, which a testnet can't.
- **Harder / limits:** payments don't arrive live on screen; they are replayed. The demo must say
  so every time, so the claim stays honest: "replayed public transfers", never "live payments" or
  "customer payments". Invoices addressed to strangers' public addresses need the banner on every
  screen.
- **Who does what:** Aashmiin approves this ADR (her decision, ~2 min). crypto-protocol-engineer
  records the missing cases; matching-engine-engineer builds the fixtures in 3 PRs; QA runs D7.1 on
  them; frontend + lead-designer add the provenance banner.
- **Risks if wrong, and containment:**
  - A fixture mislabelled `replayed-real` while synthetic would present fake data as real. Contained
    by the runner's provenance check, the reviewer checklist and the gate (held on mismatch).
  - A replayed transfer posted to a real customer's Xero. Contained by decision 5. Live posting to
    a customer's Xero is off anyway until sandbox tests pass and she approves (PRODUCT_FACTS).
  - Recorded RPC responses go stale if providers change their format. Contained: they are
    re-recordable; the demo is offline by design.
- **Follow-ups:** D6.2 for wrong-network cases; the provenance banner (PR e); `docs/DEMO.md` wording
  checked against `team/CLAIMS_REVIEW.md`.
```

---

## Approval Queue row (exactly 3 lines + risk)
```
ADR 0003: the 20 demo payments are replayed real public transfers, labelled as such; no testnet for 14 days (<link to docs PR / file>)
What changes: the 20 test payments come from recorded real public chain transfers with fictional invoices, every screen says "replayed public transfer: Clearline did not receive this money"; no test wallet or signing needed (0 min of your wallet time).
Why now: unblocks D5.1 (scenario batch 1, must start by Day 5) and target 2; your latest safe date to decide is Day 4 (Wed 4 Nov).
Risk: payments are replayed, not arriving live: if the label were ever missing the demo would overclaim; contained by provenance checks in the scenario runner and the gate, and replayed scenarios only post to demo books / the Xero Demo Company.
```

## Log rows
```
2026-11-02 2x:xx | tech-lead-architect | wrote ADR 0003 (Proposed): scenario source = replayed real public transfers | docs/adr-0003-scenario-source | <docs PR link>
2026-11-02 2x:xx | tech-lead-architect | queued for approval ADR 0003 | scenario source for the 20 test payments | <link>
```
