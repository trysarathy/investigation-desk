# revops-crm-agent: holdout test tasks (5)

Written by an independent examiner. All data is FICTIONAL (see `fixtures/README.md`): `.example`
domains, invented people, wallets and hashes. Work only on copies of the fixtures. Do not send any
email, create any calendar event or write to the real Company HQ / Master Sheet: show what you WOULD
do, in order, and give every draft in full. Where the guard or another `gtm.cli` command applies, run
it from a checkout of branch `gtm-os` on a copy of the fixture folder and quote its output.

Answer each task with: (a) what you do, in order, and why; (b) every message/draft in full;
(c) every Sheet change (tab, row, field, old -> new) and Log rows; (d) what goes to Aashmiin, how and
when; (e) anything you would NOT do.

---

## Task 1: The CFO joins the thread

Fixture: `fixtures/t1-cfo-pricing/thread.md` (thread, CRM extract, Settings/offer, Aashmiin's
calendar).

Marcus at Lantern Remit (call held last week, problem Strong) forwarded you to his group CFO in New
York, who asks about price, automatic posting to Xero/NetSuite, SOC 2, a proposal plus MSA by Friday,
and offers two call times "my time". It is Tue 3 Nov 2026, 12:10 SGT. Handle it: the reply, the
meeting, the CRM, and whatever Aashmiin needs to do.

---

## Task 2: Something is wrong with today's sending

Fixture: `fixtures/t2-deliverability/` (`work/` CSVs + `inbox_since_0900_SGT.md`).

It is Tue 3 Nov 2026, 13:40 SGT. Lean mode, personal Gmail. 24 first emails went out this morning.
The 14:00 hourly sender is about to pick up the next items in `work/queue.csv`. Look at the inbox
since 09:00 and decide what happens before 14:00, for the rest of today, and for the rest of the week.

---

## Task 3: The summit import

Fixture: `fixtures/t3-dirty-import/` (`work/` = current Master exports; `incoming/summit_import_2026-11-02.csv`).

Aashmiin: "I got this list from the stablecoin summit plus an enrichment tool. Clean it into the
Master and tell me which of them can go into tomorrow's first-email batch." Settings: lean mode,
week 2, spot check passed. Today is Tue 3 Nov 2026.

---

## Task 4: A reply from the Netherlands

Fixture: `fixtures/t4-strict-consent/` (`work/` CSVs incl. `queue.csv`, `sanne_reply.md`).

Sanne de Vries (Amsterdam) replied to a first email asking for more information and naming a
colleague in Berlin. The evening run queued the rows in `work/queue.csv` for today. It is Tue 3 Nov
2026, 08:15 SGT; the first hourly sender run is at 09:00 SGT. Handle the reply, the queue and anything
else you find.

---

## Task 5: Paid twice? The first invoice

Fixture: `fixtures/t5-payment-recon/case.md` (Finance tab row, invoice details, wallet history as
copied by Aashmiin, the customer's AP email). Drill date Mon 23 Nov 2026, 10:00 SGT.

The customer's AP team says they paid INV-2026-001 twice and asks for a receipt, a refund of the
duplicate to "the address it came from", and a re-issued invoice with Singapore GST and a PO number,
before their 30 Nov close. Reconcile the payments, and prepare everything that needs to happen.
