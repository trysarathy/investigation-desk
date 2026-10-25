# Honesty check of the pitch deck

An independent reviewer read the deck cold, first as a YC partner and then as a sceptical payments expert. It re-verified each sourced fact on the web: everything held, but some figures were overstated (fixed below). Singapore's "top-5 sender" ranking was checked only through a secondary write-up, and the Ethereum facts (block time, ERC-20) came from general knowledge because those sites were blocked.

## Claims audit and what changed

| Slide | Problem | Fix |
|---|---|---|
| 1 | 'Digital dollars' is ambiguous to payments people | Added: 'Digital dollars: stablecoins such as USDC and USDT.' |
| 2 | ~12 s block time is not finality; Maya not labelled as a persona | Footer notes confirmations take minutes; Maya marked illustrative |
| 3 | Title stated an untested claim; 'no invoice number' is true of token transfers, not every rail | Title now factual; subtitle says 'token transfer'; real cases cited (13 fake-USDT, 6 wrong-network) |
| 6 | US$226B shown without its caveats; HitPay '20,000+ merchants' overstated; Stripe limits missing; MAS 'draft' stale | '~US$226B a year: an estimate, ~0.01% of B2B payments' (McKinsey); 'offered to 20,000+'; Stripe: not Singapore, USDC, max US$10k; 'MAS consulted, Sep–Oct 2026' |
| 6 | Forecast in the notes stated as fact | Labelled [ASSUMPTION] |
| 7 | 'Handled well today' and 'exceptions land on a person' unlabelled; EDB count implied buyers | Both labelled [ASSUMPTION]; 'how many invoice in stablecoins: unknown'; EDB marked undated |
| 8 | Gap presented as a finding; TRES Finance and Cryptio not compared; Clearline row overstated | Title 'The gap I believe exists'; footer names what isn't compared; row now 'Explains 7 payment situations… matching untested on real data' |
| 8 | Elliptic/Chainalysis described without sources | Footer: described from general knowledge |
| 9 | 'Three calls' didn't say they were about an earlier idea | Added 'on an earlier idea' |
| 11 | 'Web3 companies' are not all firms that invoice businesses; S$0.9M assumed everyone buys | Row 2 reworded and marked [GUESS]; total is 'a ceiling if every one bought' |
| 12 | '111/111 explained correctly' overstated (explanations untested; 59 were tuning cases) | Now '52/52 new real transactions given the correct verdict', with the caveats in the footer |
| 13 | 'Built solo' could mislead if AI coding tools were used | 'built … myself, with AI coding tools' (please confirm) |
| A1 | 'Never matches on a guess' verified only in the demo | Labelled 'VERIFIED in the demo; untested on real data' |
| demo | Demo script stated '20-minute investigation' as fact | demo/REQUESTS_DEMO.md now says it's a guess to test |
| 6, 8 | GENIUS date and MetaMask cite secondary sources | Not fixed: both facts check out; swap in official sources if you can |

**Reviewer's verdict:** the main credibility risk was the deck claiming more than the evidence shows (111/111, the "gap", US$226B with no caveat). The rule applied everywhere: each number says exactly what its source says, no more.

## The 10 hardest questions (also in the appendix and the speaker notes)

### A YC partner

**You haven't spoken to an actual buyer. How do you know anyone has this problem?**  
Short: I don't yet. Vendors said it isn't an issue for them; my next ten calls are finance teams that receive stablecoins.  
Full: Honestly, I don't know. My only three calls were with custodian and compliance-software teams, about an earlier idea, and they said reconciliation wasn't really an issue for them. Next I'll talk to ten finance teams that receive stablecoins, asking whether customers pay through a checkout or send directly, and how many exceptions they handle. If none of them feel the pain, I'll change direction.

**Your own market estimate is S$0.9M. Why is this venture-scale?**  
Short: It isn't proven. Singapore is a test market; the region and the gateway route get sized once interviews give exception counts.  
Full: S$0.9M is deliberately a ceiling for a test market, built on a guess and an assumption. The bet is that business stablecoin payments keep growing (McKinsey and Artemis estimate about US$226B a year) and that gateways would pay per exception for their merchants. I can't size either honestly until I know how many exceptions a real finance team has, which is what the interviews ask.

**Why won't Stripe, HitPay or Circle just build this?**  
Short: They might. If buyers mostly pay through checkout pages, I'll build the plug-in for gateways instead of competing.  
Full: They could, and for payments made through their own pages they already handle matching. My untested belief is that business customers often pay directly from exchange accounts and company wallets, outside any checkout; Stripe also caps a payment at US$10,000 and takes USDC only. If interviews show most payments go through checkouts, Clearline becomes an exception-handling plug-in that gateways pay for per exception.

**Why you: a solo second-year student with no payments experience?**  
Short: I built a working product and I'm trained on the finance side. I lack payments operations experience, and I'm looking for it.  
Full: I'm a second-year accountancy student, so the finance person's side is what I'm trained in. I built the working demo myself, with AI coding tools, and tested its investigation side on real transactions. What I'm missing is payments-operations experience, and the deck says so; I'm looking for a co-founder or advisor with that background.

**What does your real-data test actually prove?**  
Short: Investigation verdicts were right on 52 of 52 new real transactions. Matching and explanations aren't tested on real data yet.  
Full: The investigation engine reached the right verdict on real on-chain cases across six networks, checked against independent sources such as Tronscan and the issuers' own contracts. It scored 43 of 59 before fixes and 59 of 59 after, then 52 of 52 on new cases collected afterwards. Company records were sample data, and the matching side and the plain-English explanations haven't been tested on real data. It shows the technology can work, not that anyone wants it.

### A payments expert

**A unique deposit address per invoice fixes missing references, and your demo uses one. What's left?**  
Short: Payments that ignore the instructions: short, wrong network, fake tokens, old addresses. How common they are, I don't know yet.  
Full: Agreed: per-invoice addresses solve most of the reference problem, and Clearline's payment page uses them. What's left are exceptions that still happen: short payments, the wrong network, counterfeit tokens, and payments to a retired or another customer's address. All of these appear in my real-data test cases. Whether they happen often enough to pay for, I'll learn by asking ten finance teams for their monthly exception count.

**Crypto accounting tools already reconcile on-chain payments to invoices. How are you different?**  
Short: They match and book; I focus on investigating exceptions and drafting the reply. I haven't tested whether that difference matters.  
Full: From their public pages, Bitwave matches payments to invoices and syncs the ERP, and Request Finance marks invoices paid. My 'leaves to a person' column is an assumption from those public pages, not from using the products, and I haven't yet compared TRES Finance or Cryptio. Before claiming a gap I'll try the main tools, including any you'd name, and ask finance teams what they do when a payment doesn't match.

**Singapore's likely buyers are licensed crypto firms with compliance tools. Why buy another?**  
Short: Maybe they won't. My three vendor calls said much the same. The buyer I need to test is the finance team receiving invoices.  
Full: It's a real risk: my three early calls were with that kind of vendor team, and they said reconciliation wasn't really an issue for them. My target is the finance team receiving invoice payments, not the compliance team, and that buyer is untested. If these firms already handle it in-house, the fallback is selling through gateways per exception, which is also untested.

**Who is liable if it marks a fake or frozen payment as paid, and do you need a licence?**  
Short: A person confirms anything non-routine, and fakes can't be marked paid. It never holds money; a lawyer must confirm licensing.  
Full: In the demo, only routine payments are marked paid by a rule; anything else goes to a person who confirms with a note, and fake tokens can't be marked paid by mistake. On real data the investigation side caught 13 of 13 fake-USDT and 11 of 11 issuer-freeze cases, but matching hasn't been tested on real data. Clearline only reads payment data and drafts messages, so I believe it sits outside a payment-services licence; a Singapore lawyer must confirm that before any live customer.

**How many exceptions does a team see a month, and what does one cost?**  
Short: I don't know. My 15–30 minutes is a guess; I'll ask ten teams for monthly counts and the staff time each takes.  
Full: I don't have a number. The 15–30 minutes per exception is a guess, and the demo's 20-minute figure is an estimate, not a measurement. Pricing depends on this, so the interviews ask how many exceptions happen a month and what one costs in staff time. If it's only a handful, the subscription model doesn't work.
