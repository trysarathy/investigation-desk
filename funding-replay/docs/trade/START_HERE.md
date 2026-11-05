# Clearline: run the complete private synthetic desk
This is the runnable provider application, separate from the anonymous Vercel walkthrough. Use fictional records only.

**Private browser workspace:** [Create a Codespace for this branch](https://codespaces.new/trysarathy/investigation-desk/tree/trade-instruments-sprint). The included dev container starts the synthetic app. In **Ports**, open **8765** in the browser. Keep port visibility private. Codespaces is a development environment in your GitHub account, not a persistent customer deployment. If auto-start fails, open the terminal and run the Mac/Linux command below from the repository root.

**Mac/Linux:** from this repository run `python3 funding-replay/tools/run_full_desk.py` and visit http://127.0.0.1:8765. It creates a persistent synthetic database in a dedicated directory under your home folder. Stop with Ctrl+C and rerun to resume. No npm or database service needed.

| Use | Synthetic account | Password |
| --- | --- | --- |
| Prepare | operator@harbourline.test | pilot-dev-operator |
| Review | reviewer@harbourline.test | pilot-dev-reviewer |

**Walk the integrated product.** Use separate browser profiles or sign out and back in when switching users:
1. Create a new documentary credit as operator; reviewer issues it. Record the presentation as operator. Inspect the documents and findings as reviewer. Accept only when appropriate. The financing task is not approval.
2. As operator, hand off the task and choose **Open funding assessment**. Supply the quote, agreement, funding amount and currency, supplier deadline, and funding window. The accepted amount, currency and parties come from the credit. The pilot supports full drawings; a waived currency/amount mismatch requires separate review. Duplicate clicks cannot create a second case.
3. Follow **Open funding case**. Supply balance evidence, request an advance and hand it to the reviewer for a separate decision. Reserve, draw, record external payout and beneficiary credit. Supplier delivery and provider exposure are shown independently. A customer receipt does not automatically reduce the debt.
4. Match a partial repayment and the final balance. Close and export the case. The funding case links back to the originating credit. A new funding case can also start directly from the queue without an LC.
5. From the case open **Decision replay and comparison** to see what was known at a checkpoint; compare operator effort only when scopes and outcomes are comparable. **Check possible duplicate invoices** searches this provider's records only and records a human disposition, without claiming a credit check across other lenders.

**Other desks:** Collections and eBL evidence have separate workflows. Message parsing, sandbox bank events and the calendar planner are tools for operators; none creates a live undertaking, executes a transfer or transfers title. See [trade architecture](SPRINT.md), [security and running the private pilot](../pilot/README.md), and [backup/recovery](../pilot/RECOVERY.md). For hosting, provision a private environment and durable storage instead of exposing the local synthetic launcher.
