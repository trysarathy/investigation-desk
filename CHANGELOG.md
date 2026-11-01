# Changelog

Plain-English notes for every merged change, newest first (company/OPERATING_MODEL.md §2 item 8).
Each entry: date, PR link, one paragraph a finance controller can understand: what changed, why, and
anything they need to do.

## 2026-11-01
- **One plain sentence per payment, with an honest time estimate (part 1: the wording).** Clearline now works out, for every payment request, one sentence saying what happened and what to do, e.g. "Confirming: about 2 minutes until it's confirmed, and there's nothing to do yet." or "Short by 50.00 USDC: ask the customer for the rest, or accept it as settled." Time estimates come only from Ethereum's documented 12-second slots and the 12 confirmations Clearline waits for today; where a time can't be worked out (not yet included, a live payment that only updates when looked up again, a network we have no timing for, or the network didn't answer) no time is shown. The words say "confirmed", not "final", because Clearline doesn't yet use Ethereum's own finality signal. Also fixed: the request page said "about about 2 minutes" and called 12 confirmations "final for practical purposes". Nothing to do on your side.
- **The At a glance screen no longer says payments are paid automatically outside the demo.** Automatic marking is a demo-only rule, but the live screen showed a "Paid automatically" tile, a "time saved" estimate and the line "Every payment is matched, checked and explained". In live mode the tile now reads "Checked and ready to mark paid" (payments waiting for you), the time-saved estimate is gone, and the "I've asked for the balance" hint, next step and customer reply say a person marks the invoice paid: nothing is marked paid until you confirm. The demo keeps its wording, now labelled demo. Nothing to do on your side.
- **CHANGELOG started.** From today every merged pull request adds an entry here.
