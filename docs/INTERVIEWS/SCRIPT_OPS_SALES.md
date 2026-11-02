# Script: operations / sales / fulfilment (who releases goods or services)

Use with `SCRIPT_CORE.md`. Replaces the core's story block. Who: the person who decides "OK, ship it /
release it / activate the account" after a customer pays in stablecoins (exporter, merchant, agency,
OTC client desk, SaaS). DRAFT, 2026-11-02.
Main hypothesis: **H1** (Vishal: why fix it at period end instead of the moment payment comes in?).
Do **not** ask about accounting detail beyond Q9; they may not know it, and that is itself data.

| # | Question | Tests | Supports if they say… | Refutes if they say… |
|---|---|---|---|---|
| 1 | "Tell me about the last order a customer paid for in stablecoins. What happened from 'customer says they've paid' to you releasing it?" | H1 | Waiting, chasing, a screenshot or hash passed around, a named delay | Instant and confident (a gateway confirms) |
| 2 | "What did you look at to decide the money had really arrived? Who did you ask?" | H1 | Block explorer, asking finance/founder, customer's screenshot | A system notification they trust |
| 3 | "How long did that take, last time? And the longest it has ever taken?" | H1 | Hours or days; customer pressure | Seconds/minutes |
| 4 | "Has a customer ever shown you a payment that turned out short, on the wrong network, or not real? Tell me what happened." | H1/H4 | A dated story; a loss; a new rule ("we wait for finance now") | Never |
| 5 | "Have you ever released before it was confirmed, because the customer was pushing? What happened?" | H1 | Yes, with consequences | Never; strict rule that has worked |
| 6 | "Has the opposite happened: money arrived fine but you held the order because nobody could confirm? What did that cost (customer, time)?" | H1 | Lost deals, angry customers, overtime | No |
| 7 | "Who has to be available for you to release? What happens at night or on weekends?" | H1 | Single person bottleneck (founder/finance), out-of-hours delays | Anyone can check, no bottleneck |
| 8 | "Roughly how many stablecoin-paid orders did you handle last month?" | H1/H4 | Monthly or more (their number) | A couple a year |
| 9 | "After you release, how does finance find out, and has anything ever not matched later?" | H1/H4 | Disconnect between ops and books; month-end surprises | Same system; nothing goes wrong |
| 10 | "What have you tried to make the 'has it arrived' check faster or safer? Why that?" | H1 | Built a bot/spreadsheet/explorer bookmark; paid a gateway; still gaps | Gateway solved it fully (name it) |
| 11 | "Which of these took the most of your team's time last month?" | all | A clear pain with their number | None |

Close: core asks. Especially: "Who in finance should I speak to?" (pairs H1 with H4/H2 at the same firm).
