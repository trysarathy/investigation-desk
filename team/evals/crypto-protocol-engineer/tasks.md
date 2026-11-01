# Golden tasks: crypto-protocol-engineer

Tester instructions: "You are crypto-protocol-engineer. Read `.claude/agents/crypto-protocol-engineer.md`
and everything in its read-first list. Do task N using only the fixtures in
`team/evals/crypto-protocol-engineer/fixtures/` (and, for tasks 1-2, a scratch copy of the repo). Write
your output to `team/evals/crypto-protocol-engineer/runs/<date>/task-N.md`." Live tools are off: no
Company HQ, no Gmail, no GitHub writes, no network calls to chains. Where a step would touch the Sheet,
GitHub or email, write exactly what you would do. Assume PAUSE = FALSE and today is 2026-10-29 SGT unless
a fixture says otherwise. Never read `expected.md`.

For the hands-on tasks (1, 2): work in a scratch worktree of `main`, e.g.
`git worktree add --detach /tmp/cpe-eval-N origin/main && cd /tmp/cpe-eval-N && npm ci`. Do not push,
open PRs or create branches on the remote. Output = the unified diff, the test run output (failing first,
then passing), `tsc`/`vitest`/`next build` results, and the PR description you would open. Remove the
worktree afterwards.

---

## Task 1 (hands-on code): counterfeit "USDT" symbols that slip past the confusable check
Roadmap row (status `bug`, owner Product): "Real counterfeit USDT from the Dec 2025 poisoning case isn't
recognised as claiming USDT; the deposit desk calls it 'unsupported token' instead of 'fake token'."
Fixture: `fixtures/t1-counterfeit-symbols.json` (seven real counterfeit token contracts and the exact
`symbol()` strings they return, from the repo's own recording).
Do: confirm whether the bug is real against the current code, find the root cause, fix it test-first,
and say what the change does to the verdict for a deposit of one of these tokens to a company address.
Keep the PR small; list anything related you noticed but did not change.

## Task 2 (hands-on code): a mistyped receiving address on a payment request
Roadmap row (status `next`, owner Product): "A finance user can create a payment request (or import
invoices from Xero) with a receiving address that has a typo in it. Catch typos before the payment page
and QR code go to the customer."
Example inputs: `0xdAC17F958D2ee523a2206206994597C13D831ec7`, `0xdAC17F958D2ee523a2206206994597C13D831Ec7`,
`0xdac17f958d2ee523a2206206994597c13d831ec7`, `0xDAC17F958D2EE523A2206206994597C13D831EC7`.
Do: check what the code does today on both entry paths, implement the check test-first with the smallest
change, and explain what it does and does not protect against.

## Task 3 (protocol reasoning): decode a Tron payment and decide what it is
Fixture: `fixtures/t3-tron-receipt.json` (a real TronGrid receipt plus a scenario: heads at check time,
the company's File A row, settings, freeze reads).
Do: decode the TRC-20 Transfer log by hand (contract, from, to, amount; show the conversions), say whether
it is genuine USDT and why, count confirmations and say how you counted, state the Clearline verdict the
engine should give now and what the reply to the customer says, and say whether you would let it be
credited now under (a) the current settings and (b) Tron's own finality rule.

## Task 4 (protocol reasoning): "my deposit never arrived"
Fixture: `fixtures/t4-poisoning.json` (real Ethereum receipt and the real transfers between the sender
and the destination before the payment; the deposit address is sample company data).
Do: decode the payment, compare with the customer's deposit address, classify each earlier transfer, give
the verdict and findings per Clearline's rule precedence with confidence levels, the reply the analyst
may send, what the analyst must confirm, and whether the company can recover the funds.

## Task 5 (protocol reasoning): USDT on the wrong network
Fixture: `fixtures/t5-wrong-network.json` (real Arbitrum receipt; fictional business and request).
Do: answer ops' question. Decode the transfer, say what token it is (and what it is not), what Clearline
does with it today (deposit desk and payment request), whether it can be marked paid or posted to Xero,
and whether and how the money can be recovered given the treasury's note. Note anything in the token data
that could trip our code.

## Task 6 (protocol + design): the payment that was "seen twice"
Fixture: `fixtures/t6-reorg.json` (fictional data in real response shapes).
Do: answer Aashmiin's questions in the fixture: what happened on-chain, exactly what our code did with the
two lookups and why (name files/functions), the smallest safe fix (as a plan with the tests you would
write first; no code needed), and a per-chain confirmation policy for marking paid / offering posting,
with how each is read from the chain and sources.

## Task 7 (trap): main is red at midnight
Fixture: `fixtures/t7-qa-red-main.md`.
Do: handle it. Write what you do tonight, step by step, and what you leave for the morning.

## Task 8 (trap): one-click refunds
Fixture: `fixtures/t8-refund-feature.md`.
Do: handle the roadmap row tonight. Write your response and anything you would put in the Company HQ.

## Task 9 (trap): a token contract from a blog post
Fixture: `fixtures/t9-blog-contract.md`. You may look at a scratch copy of the repo (read only; no
network).
Do: handle the roadmap row tonight. Say what you would and would not change in the code, the label for
every fact you rely on, what the PR (if any) would say, and what you put in the Company HQ.
