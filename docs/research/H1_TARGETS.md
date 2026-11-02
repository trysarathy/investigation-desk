# H1 targets: sellers paid in USDT/USDC to their own wallet (SG, HK, UAE free zones)

research-intern, 2 Nov 2026 (SGT). Input for H1 discovery (`docs/PROBLEM_BRIEF.md` §2 H1, §5, §6; `docs/research/H1_H4.md`).
India excluded (FEMA question unresolved). UAE mainland excluded (CBUAE payment-token rule, see H1_H4.md counter-forces).

**Drafts only; Aashmiin contacts them. Nothing has been sent.**

## Result in one line
**0 of the 30 own-wallet targets could be verified this run.** No company page was opened. The session's network
allowlist blocked every target host I tried (DNS "ENOTFOUND"). The only hosts that opened were gateway hosts
(coingate.com, nowpayments.io). Per the brief, a search snippet does not count, so nothing below counts toward the 30.
I have not padded the list.

| Count | Number |
|---|---|
| Own-wallet, VERIFIED (page opened this run) | **0** |
| Own-wallet candidates, search snippet only (do not count) | 5 |
| Gateway users, search snippet only (lower priority, do not count) | 4 |
| Rejected | 9 |
| Target hosts tried and blocked | 15 |

## Method
1. WebSearch (13 queries) for own-wallet wording ("pay USDT TRC20 to this address", "we accept USDT", payment-methods
   pages) by segment: hosting/VPS/proxy, trading/electronics, freight, car/yacht, corporate-service agents, agencies/SaaS.
   I also ran one query restricted to coingate.com and nowpayments.io for named merchants.
2. I tried to open each candidate's own page with WebFetch, and probed hosts with curl (HTTP status only). Every
   non-gateway host failed. A wider host probe was refused by the session's permission classifier, so I stopped
   probing. I did not try to get round the block through mirrors or caches.
3. Labels follow company rule 2 and `team/knowledge/research-intern/lead-evidence.md`. A snippet is
   `[ASSUMPTION: search snippet]`. Evidence grade (E1–E4, W1–W3) is given as "if confirmed".

## Table A: own-wallet targets, VERIFIED
None (0). Aim was 30.

### A-candidates: own-wallet or unclear, search snippet only (do NOT count; open by hand or after allowlist change)
| # | Company | Country / zone | What they sell | Evidence (snippet, not opened) + link + label | Chain/token seen | Contact route | Role to ask for | H1 fit note | Priority (if confirmed) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Server.HK (footer per snippet: "Hosting Limited, Hong Kong") | Hong Kong | VPS / dedicated servers | The search result says the USDT checkout shows an address and amount to copy, and that the server is "provisioned automatically after on-chain confirmation, typically within 1–5 minutes for TRC-20". https://server.hk/blog/cryptocurrency-usdt-payment-vps-hosting-guide/ , https://server.hk/vps/ [ASSUMPTION: search snippet] | USDT TRC-20 | Portal https://my.server.hk/ [ASSUMPTION: search snippet]; contact page not opened | billing/ops lead | Grants access on payment: the core H1 shape. But auto-provisioning means they may already have a paid signal (own module or gateway, unknown). Good kill-test call | B |
| 2 | SurferCloud | Hong Kong servers (entity country unknown) | Cloud servers | Blog says it accepts USDT for HK cloud servers. https://www.surfercloud.com/blog/best-hong-kong-vps-hosting-surfercloud-server [ASSUMPTION: search snippet] | USDT (network unknown) | unknown | billing/ops lead | Entity and receiving method unknown | B |
| 3 | OperaVPS | Lists Singapore as a location; entity country unknown | VPS | "Buy VPS with USDT: TRC-20, ERC-20, BEP-20". https://operavps.com/tether-vps/ [ASSUMPTION: search snippet] | USDT TRC-20/ERC-20/BEP-20 | unknown | billing/ops lead | The entity may not be in SG/HK/UAE; check before use | B (only if entity is in scope) |
| 4 | Samana Group (Star Business Centre, JLT/DMCC) | UAE, DMCC (per snippet) | Office space rental | Press report says it accepts digital currencies as rental payment for its office space. https://meconstructionnews.com/27125/samana-to-accept-bitcoin-for-rental-payments/amp [ASSUMPTION: secondary, search snippet] | Bitcoin named; USDT not confirmed | unknown | finance/ops lead | Secondary source only, and the token is unconfirmed. Rent is recurring, but release is less urgent | B |
| 5 | Dubriani | Dubai (licence type unknown; may be mainland) | Yacht charter | Site says it accepts USDT "with no limit on the amount" and warns to "send only the requested asset through the specified network". https://dubriani.com/charter-a-yacht-with-bitcoin/ [ASSUMPTION: search snippet] | USDT (network per request) | unknown | ops/sales lead | Releases a booking on payment, so the shape fits. Mostly consumer-facing; mainland status would exclude it | B, and only if it is free-zone and B2B |

## Table B: gateway users (lower priority; a gateway already sends them a paid signal)
None verified. Snippet-only:

| # | Company | Country / zone | What they sell | Evidence + link + label | Gateway | Contact route | Role to ask for | H1 fit note | Priority |
|---|---|---|---|---|---|---|---|---|---|
| G1 | Virtuzone | UAE (corporate-service provider; zone unknown) | Company formation and visas | Press report says it is the "first UAE corporate services provider to accept cryptocurrency payments via Binance Pay". https://zawya.com/en/business/fintech/virtuzone-to-accept-crypto-via-binance-pay-ckzij1dh [ASSUMPTION: secondary, search snippet] | Binance Pay | unknown | ops lead | The gateway signals "paid". Useful only to learn whether they still check by hand | B |
| G2 | Start Any Business (SAB) | UAE (licence no. 927104 per its site title) | Company formation and visas | Press release says it accepts "Tether (USDT)" for company formation and visas, partnered with HAYVN. https://www.startanybusiness.ae/press-release/sab-partnered-with-hayvn-accepting-crypto-payment-or-company-formation/ [ASSUMPTION: search snippet] | HAYVN | unknown | ops lead | Via a gateway/OTC partner | B |
| G3 | MW Motors | Dubai (licence type unknown) | Luxury cars | DubiCars post says it uses "professional payment gateways and escrow-style processes" for crypto. https://www.dubicars.com/news/?p=91106 [ASSUMPTION: secondary, search snippet] | Gateway (unnamed) | unknown | sales lead | Likely mainland, which would exclude it | B |
| G4 | Gulf Craft | UAE (shipyard; zone unknown) | Yachts, refit | Press release says stablecoins (USDT, USDC) are converted to AED/USD via a Bahrain-licensed provider. https://www.zawya.com/en/press-release/companies-news/gulf-craft-becomes-first-mena-shipyard-to-accept-regulated-crypto-to-fiat-payments-v9kdqe8c [ASSUMPTION: secondary, search snippet] | Crypto-to-fiat provider (converts) | unknown | sales/ops lead | Flag `converts`: the provider settles in fiat, so this is the weakest fit | B |

## Rejected
1. 96M (96m-sgbet.pages.dev): gambling site mirror listing "USDT (TRC20)" deposits. Excluded: gambling.
2. Kiklabb (Dubai): government-owned licensing entity taking crypto for licence and visa fees. Excluded: a government body, not a seller.
3. DMCC (authority): signed a non-binding MoU with Tether (Jun 2026). Its own payment-modes page, per snippet, lists bank, card and Apple/Google Pay but no USDT. It is a regulator/landlord, not a target. Good context only [ASSUMPTION: search snippet, https://dmcc.ae/payment-modes].
4. RAKEZ (authority): invoices payable by gateway link, bank transfer or cheque per a 2022 notice; no USDT. Not a seller.
5. Sarnies (Singapore café): consumer-only.
6. Palazzo Versace Dubai dining: consumer-only; Binance Pay; no USDT listed.
7. Siam Rice Export: a good H1 shape (exporter settled in USDT TRC20 via NOWPayments), but it is in Thailand, outside SG/HK/UAE, and uses a gateway. NOWPayments case study: https://nowpayments.io/blog/case-study-siam-rice-export (host reachable; not opened this run).
8. Xclusive Yachts (Dubai): consumer charter; the receiving method is not stated; may be mainland. Host blocked.
9. Kompass "Various small electronic goods" HK lead: a **buyer** wanting to pay in USDT, not a seller receiving it (W2-type, wrong side).

No candidate looked like sanctions evasion or a scam, but none was checked against enforcement news, because no page could be opened.

## Draft first message
**Not written by research-intern.** My definition (`.claude/agents/research-intern.md`, "Never draft outreach or
customer-facing copy") and the company's rule that research-intern never drafts outreach mean I must route this
to its owner, revops-crm-agent, or to Aashmiin. Facts for whoever writes it:
- Purpose (Mom Test): learn how they confirm a USDT/USDC payment before releasing goods or access: who checks, with
  what (explorer, screenshot, gateway, OTC chat), and the last time it went wrong.
- Constraints from the brief: ≤70 words; no product claims, numbers, prices or pitch; marked DRAFT, Aashmiin sends.
- Interview scripts already exist: `docs/INTERVIEWS/SCRIPT_*.md`.

## Blocked hosts (2 Nov 2026, this session; WebFetch DNS ENOTFOUND or curl status 000)
server.hk, host4fun.com, bit.hosting, operavps.com, 1gbits.com, coin.host, vikhost.com, dubicars.com,
premiumcrystal.ae, friendscarrental.com, hosteons.com (and blog.), lowendtalk.com, caasify.com, dubriani.com,
xclusiveyachts.com. Generic hosts (google.com, example.com, cryptwerk.com) were also blocked, so the allowlist is
narrow. Reachable: coingate.com, nowpayments.io (gateway hosts only).

## What would unblock this
- **Option 1 (fastest):** Aashmiin opens the 5 A-candidates by hand. Or a session runs with open web egress, or with
  the target domains allowed under environment → Network access. Then research-intern re-runs this list and fills the
  30 with pages opened that run.
- **Option 2:** if egress stays narrow, H1 targets cannot be verified from this environment. Every own-wallet seller
  lives on its own domain, and no allowlist can be known in advance.
- **Search yield is also low.** 13 queries gave 5 own-wallet-shaped candidates in scope. Most B2B traders in SG/HK/UAE
  do not publish USDT payment instructions on public pages. They send them on invoices or in chat. That is a
  reachability finding for H1 in itself [ASSUMPTION: from this search run only].
