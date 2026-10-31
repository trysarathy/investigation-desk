# Look-alike addresses and poisoning, as they affect matching

## The attack (copied with its original labels)
The attacker creates a vanity address matching the first and last characters of an address the victim
sends to, plants it in the victim's history (zero-value `transferFrom`, dust, or a counterfeit-token
"transfer from the victim to the look-alike"), and the victim later copies the wrong address. Scale:
~270 million attempts against ~17 million victims on Ethereum and BNB Smart Chain, 6,633 incidents with
≥ US$83.8 million lost (1 Jul 2022-30 Jun 2024) [VERIFIED: crypto-protocol-engineer 2026-10-31,
https://arxiv.org/abs/2501.16681; I re-opened the abstract page on 2026-11-01 and saw the title
"Blockchain Address Poisoning", not the figures].

Real cases in the repo [VERIFIED: matching-engine-engineer 2026-11-01, `tests/real_cases.json`]:
POISON-1 (Dec 2025, 49,999,950 USDT to `0xbaff…f8b5` instead of `0xbaf4…f8b5`: first 3 + last 4 equal)
and POISON-2 (Aug 2026, forged counterfeit transfer). Both are in the **tuning** set; the held-out set
has **no** poisoning case.

## Why it matters for matching (our reasoning)
- To an invoice matcher, a poisoned payment looks like "a payment of exactly the invoice amount, from
  the right customer, at the right time, to almost the right address". Amount + sender + timing
  scoring (`suggestMatches`: 40 + 35 + 15 + 10 = 100, "Strong") would rank it top **if** it were an
  unidentified payment at a business address. It isn't today: a poisoned payment goes to the
  attacker's address, which no request uses, so our system never even sees it as a transfer to the
  business — unless the business watches a set of addresses that includes the look-alike (it can't),
  or a person pastes the hash into the request (`attach_hash`), where `transferIssue` returns
  `wrong_address` (`lifecycle.ts:287`). The customer says "I paid"; the right answer is "you paid a
  look-alike address", never "matched".
- Rule: **similarity of address is evidence of an attack, never evidence of a match.** A matcher must
  not treat "first/last characters equal" as a positive signal.
- The money is not recoverable by the business; an auto-match would book revenue that never arrived.
  That is the worst false match we can make.

## Three look-alike rules in one product (spec vs code) [VERIFIED: matching-engine-engineer 2026-11-01]
| Where | Rule |
|---|---|
| `docs/SPEC.md:86` (D07b) | first 4 **and** last 4 characters, plus a prior zero-value/dust transfer |
| `src/lib/engine/context.ts:101-111` `looksAlike` | first 3 **and** last 4 (after "0x" or "T"); comment: the first-4 rule missed POISON-1 |
| `src/lib/requests/lifecycle.ts:557-563` `compareAddress` (payment page) | first 4 **or** last 4: deliberately broad, it warns a payer before sending |

These are not a bug by themselves (detection before payment should be broader than diagnosis after),
but the spec is out of date and nobody has measured either rule's false-alarm rate on real address
pairs. A change to any of them is a threshold change (playbook §3). Changing the spec is Aashmiin's call
(`needs decision` row).

## Gaps that touch matching
- Request path: D07b and D09 never fire (`check.ts:61` sets history and freeze to `not_supported`).
- Typos in the invoice's own receiving address: `validateRequest` accepts any `0x` + 40 hex
  (crypto-protocol-engineer gap G3: `[VERIFIED: crypto-protocol-engineer 2026-10-29, attack-patterns.md A2 / codebase-map.md]`).
  A typo'd invoice address makes every correct payment look like `wrong_address`.
- No labelled set of near-miss address pairs exists to measure `looksAlike` / `compareAddress`
  false-alarm rates.

## Dataset cases to build (look-alike row)
Real poisoning transfers (from the paper's dataset or explorer-tagged incidents) paired with a SAMPLE
invoice whose address is the victim's intended address; real benign pairs that share first 3 + last 4 by
chance (to measure false alarms); typo'd invoice addresses (EIP-55 mixed-case one-char change). Every
case labelled `flag`, never `auto_match`.
