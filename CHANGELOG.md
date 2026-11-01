# Changelog

Plain-English notes for every merged change, newest first (company/OPERATING_MODEL.md §2 item 8).
Each entry: date, PR link, one paragraph a finance controller can understand: what changed, why, and
anything they need to do.

## 2026-11-01
- **One plain sentence per payment (part 1: the wording).** Each payment request now has one plain sentence saying what happened and what to do, e.g. "Short by 50.00 USDC: ask the customer for the rest, or accept it as settled." There is no countdown: Clearline only updates a real payment when you look it up again, so while one is confirming the sentence gives Ethereum's usual pace ("Ethereum usually takes about 2 minutes") and asks you to look it up again; it is not a promise of when yours will be done. The words say "confirmed", not "final", because Clearline doesn't yet use Ethereum's own finality signal. Also fixed: the request page said "about about 2 minutes" and called 12 confirmations "final for practical purposes". Nothing to do on your side.
- **The At a glance screen no longer says payments are paid automatically outside the demo.** Automatic marking is a demo-only rule, but the live screen showed a "Paid automatically" tile, a "time saved" estimate and the line "Every payment is matched, checked and explained". In live mode the tile now reads "Checked and ready to mark paid" (payments waiting for you), the time-saved estimate is gone, and the "I've asked for the balance" hint, next step and customer reply say a person marks the invoice paid: nothing is marked paid until you confirm. The demo keeps its wording, now labelled demo. Nothing to do on your side.
- **CHANGELOG started.** From today every merged pull request adds an entry here.
