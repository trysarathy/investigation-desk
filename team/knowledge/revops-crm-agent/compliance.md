# Compliance: may we cold-email this business contact?

Accessed 2026-10-29. **Not legal advice.** The guard's country list (`gtm/model.py::STRICT_COUNTRIES`) and
RULES.md are the operating law for us; this file explains why, and what else each regime requires. No
primary legal page could be opened from the build session (hosts blocked), so external facts are
**[ASSUMPTION: search-only]** unless marked otherwise. Anything uncertain → draft only and ask Aashmiin
(who asks a lawyer).

## 0. Decision table (what you actually do)
| Recipient country | Cold email from personal Gmail? | Extra conditions | Why (short) |
|---|---|---|---|
| Singapore | Yes | Business contact info only; opt-out line; honour opt-outs same day; 30-day bulk line (1,000) | PDPA excludes business contact info; Spam Control Act bulk duties |
| United States | **Only after `POSTAL_ADDRESS` is set** (guard) | Opt-out; honest header/subject; postal address in signature; no US time zone in code yet | CAN-SPAM, no B2B exemption |
| United Kingdom | Yes, to **corporate** subscribers (Ltd, LLP, plc, public bodies) | Not sole traders/partnerships; identify sender; opt-out; legitimate-interest basis; be able to say where we got the address | PECR + UK GDPR |
| EU, not on strict list (e.g. France, Ireland, Belgium, Portugal, Nordics, Baltics, Poland...) | Yes, with care | Work address, role-relevant message, opt-out, LIA, source disclosure on request; check national rule if in doubt | GDPR Art 6(1)(f) + ePrivacy as implemented nationally |
| **Germany, Austria, Italy, Spain, Netherlands** | **No** (guard blocks) | LinkedIn by hand or a warm intro first | National ePrivacy rules require prior consent even B2B (NL disputed; RULES.md treats it as strict) |
| **Vietnam, South Korea, Colombia, South Africa** | **No** (guard blocks) | LinkedIn or intro | RULES.md list (sources in lead research; not re-researched here) |
| Canada | **Not yet**: no time zone in code; treat as needs-approval | Implied consent only if address conspicuously published, no "no unsolicited email" notice, message relevant to role; identify + unsubscribe | CASL |
| Australia | Yes, if inferred consent holds | Address conspicuously published, no refusal notice, relevant to role; identify sender; functional unsubscribe | Spam Act 2003 |
| India | Yes today, review before **13 May 2027** | Opt-out; business purpose; no sale of data | DPDP Act 2023 operative rules start 13 May 2027 |
| Anywhere | Never | Do-not-contact, support@ inboxes, personal (non-work) addresses, guessed addresses, harvested lists, minors | All regimes / our rules |

## 1. United States: CAN-SPAM Act
Sources: FTC, "CAN-SPAM Act: A Compliance Guide for Business",
https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business [ASSUMPTION:
search-only]; secondary: https://iapp.org/resources/article/the-can-spam-act-a-compliance-guide-for-business .
- **No B2B exemption**: the FTC guide says the law "makes no exception for business-to-business email".
- No prior consent needed. Requirements for commercial messages: accurate header/From/routing; subject
  line not deceptive; identify the message as an ad where it is primarily commercial; **a valid physical
  postal address** (street, registered PO box or private mailbox); a clear opt-out that works for at least
  30 days, honoured within **10 business days** [ASSUMPTION: general knowledge, the search did not return
  that line]; you remain responsible for anyone sending on your behalf.
- Penalties are per email and inflation-adjusted (older FTC text says up to $16,000; it is higher now)
  [ASSUMPTION: search-only].
- For us [ASSUMPTION]: a learning-call request that names Clearline could be read as commercial, so we treat
  it as commercial. The guard blocks US first emails until `POSTAL_ADDRESS` is set; when it is, it must
  appear in the signature (the current `lean.SIGNATURE` has no address line: crypto-protocol-engineer must
  add it before US sends; flag it).

## 2. United Kingdom: PECR + UK GDPR
Sources: ICO, "Electronic mail marketing" (PECR guide),
https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/electronic-and-telephone-marketing/electronic-mail-marketing/
[ASSUMPTION: search-only]; commentary: https://www.scl.org/10176-b2b-communications-a-welcome-ico-turnaround/ ,
https://legalvision.co.uk/data-privacy-it/rules-emailing-corporates-consumers-marketing-promotions/ .
- PECR's consent rule for marketing email protects **individual subscribers**, which include **sole traders
  and some partnerships**. **Corporate subscribers** (limited companies, LLPs, plcs, government bodies) can
  be emailed without prior consent, but the sender must **identify itself** and give a **valid address for
  opt-out**; keep a suppression list.
- UK GDPR still applies: a named employee's work address is personal data. Basis = legitimate interests
  (document the balance: B2B, role-relevant, low volume, easy opt-out); be transparent about the source
  (Art 14) and stop at once on objection (Art 21).
- For us: check the company suffix (Ltd/LLP/plc). A sole trader or "& Co" partnership → LinkedIn instead.
  Keep `first_line_source` so we can answer "how did you get my email?" truthfully.

## 3. European Union: GDPR + ePrivacy Directive (2002/58/EC)
Sources: GDPR Recital 47 and Art 21 (https://gdpr-text.com/read/recital-47/ ,
https://eur-lex.europa.eu/eli/reg/2016/679/oj), ePrivacy Directive Art 13
(https://eur-lex.europa.eu/eli/dir/2002/58/oj); commentary https://www.gdprregister.eu/gdpr/direct-marketing-rules-and-exceptions/ ,
https://www.cpomagazine.com/data-protection/direct-marketing-under-the-gdpr-consent-vs-legitimate-interests/
[ASSUMPTION: search-only].
- GDPR Recital 47: direct marketing "may be regarded as carried out for a legitimate interest", subject to a
  case-by-case balancing test. Art 21(2)-(3): the person can object to direct marketing at any time and
  processing for it must stop (absolute). Art 14: tell people where their data came from. GDPR likely
  applies to us even from Singapore when we target people in the EU (Art 3(2)) [ASSUMPTION].
- ePrivacy Art 13 requires prior consent for unsolicited marketing email to **natural persons** (with a
  customer "soft opt-in" exception); for **legal persons** each Member State decides (Art 13(5))
  [ASSUMPTION: general knowledge]. Hence the national split:
  - **Germany**: UWG §7(2) requires prior express consent for advertising email, with **no B2B exemption**
    (§7(3) existing-customer exception only) [ASSUMPTION: search-only, https://overloop.com/blog/b2b-cold-email-germany-gdpr-compliance].
  - **Austria**: Telecommunications Act (TKG 2021 §174; formerly TKG 2003 §107) requires prior consent,
    B2B included [ASSUMPTION: search-only; section number differs between sources].
  - **Italy** (Privacy Code art. 130, Garante) and **Spain** (LSSI art. 21): prior consent expected even for
    company addresses [ASSUMPTION: search-only, https://www.dealfront.com/guides/guide-to-cold-calling-and-emailing-europe].
  - **Netherlands**: sources conflict (some say B2B legitimate interest works; others list NL as opt-in)
    [ASSUMPTION: search-only]. RULES.md lists NL as strict: we follow RULES.md.
  - France (CNIL), Ireland and others are generally described as allowing role-relevant B2B email to work
    addresses with an opt-out [ASSUMPTION: search-only].
- For us: guard blocks the strict list. For other EU countries: named work address only, role-relevant
  question, opt-out line, source kept; any objection → Do-not-contact the same day.

## 4. Singapore: PDPA + Spam Control Act 2007
Sources: Spam Control Act 2007, https://sso.agc.gov.sg/Act/SCA2007 ; IMDA best practices,
https://imda.gov.sg/infocomm-regulation-and-guides/unsolicited-communications/best-practices-for-organisations ;
PDPC press release 2016, https://pdpc.gov.sg/news-and-events/press-room/2016/06/blanket-ban-on-b2b-marketing-messages-may-hinder-legitimate-business-activity
[all ASSUMPTION: search-only].
- **PDPA**: business contact information (name, title, business phone/email/address) is excluded from the
  main obligations when used for business purposes; the PDPC says the Do Not Call provisions do not apply to
  B2B marketing messages. Data used for personal purposes is still covered.
- **Spam Control Act** applies to unsolicited commercial electronic messages **sent in bulk**: more than
  **100** similar messages in 24 hours, **1,000** in 30 days or **10,000** in a year. Bulk duties: an
  unsubscribe facility, honour requests within **10 business days**, `<ADV>` label in the subject, accurate
  header/subject, no dictionary attacks or harvested address lists.
- For us: 75/day across ~21 weekdays is ~1,500 a month, **above** the 1,000/30-day line. The guard alerts at
  900 and stops at 1,000 until `BULK_CONFIRMED` (set by Aashmiin after a professional confirms the duties,
  e.g. `<ADV>` in subjects). At the current caps expect the alert about **2-3 weeks after LEAN_START**:
  warn her early. Whether the 100-per-24-hours line also bites at 75/day is a question for her lawyer, with
  the follow-ups counted [ASSUMPTION].

## 5. Canada: CASL
Sources: Federal Court of Appeal summary via https://www.blg.com/en/insights/2020/07/federal-court-of-appeal-rules-casl-constitutionally-valid-and-provides-interpretive-guidance ;
https://www.mltaikins.com/insights/casl-is-constitutional-and-some-guidance-on-how-to-interpret-it/
[ASSUMPTION: search-only]; CRTC guidance at https://crtc.gc.ca (not opened).
- Commercial electronic messages need **consent** (express or implied). Implied consent by **conspicuous
  publication** needs all three: address conspicuously published, no statement refusing unsolicited
  messages, message relevant to the person's business role. Mining third-party directories doesn't qualify;
  **the sender must prove** all three (keep the evidence). Messages must identify the sender and include an
  unsubscribe mechanism (honour within 10 business days) [ASSUMPTION: general knowledge].
- For us: Canada has no time zone in `lean.TZ_OFFSET` (the guard blocks it with `--now`). Do not send to
  Canada until Aashmiin approves and the code has the zone; keep the screenshot/URL proving publication.

## 6. Australia: Spam Act 2003
Sources: https://www.legislation.gov.au/C2004A01214/latest/text ; summaries
https://www.mondaq.com/australia/consumer-law/996226/spamming-and-the-spam-act ,
https://pointonpartners.com.au/spam-act/ [ASSUMPTION: search-only].
- Consent required: express or **inferred**. Conspicuous publication gives inferred consent only if the
  address is published, has no "no commercial messages" statement, and the message relates to the person's
  role; "mere publication" is not enough. Every message must identify the sender and contain a functional
  unsubscribe; honour within **5 working days** [ASSUMPTION: general knowledge, not in the search result].
- For us: allowed for a named finance person whose address is on the company's own page, with the opt-out
  line; never from directories.

## 7. India: Digital Personal Data Protection Act 2023
Sources: DPDP Rules 2025 notification summaries, https://www.mondaq.com/india/data-protection/1708164/digital-personal-data-protection-rules-2025-notified ,
https://www.tribuneindia.com/news/business/govt-notifies-digital-personal-data-protection-rules-rollout-in-phases-specified-obligations-for-data-fiduciaries
[ASSUMPTION: search-only].
- The DPDP Act is consent-based (plus narrow "legitimate uses"), with no business-contact carve-out like
  Singapore's [ASSUMPTION: general knowledge]. The Rules were notified **13 Nov 2025**; the Board provisions
  apply at once, Consent Manager rules from **13 Nov 2026**, and the operative notice/consent/security rules
  from **13 May 2027**.
- For us: B2B cold email to Indian work addresses is low-risk today [ASSUMPTION], but **before May 2027**
  Aashmiin should get advice on whether role-based B2B email needs consent under DPDP. Log a Risks row now.
  Telecom-marketing rules (TRAI) cover calls/SMS, not email [ASSUMPTION].

## 8. Rules that hold everywhere (ours)
- Honest identity (her name, SMU student, Clearline); truthful first line with source; one opt-out line;
  opt-outs and complaints to Do-not-contact the **same day**; never personal (non-work) addresses, guessed
  addresses, bought or scraped lists, or anyone who said no. Buying data = spending money = her approval.
- Keep the evidence: `first_line_source`, `evidence_url`, where the email was seen (`email_label`). This is
  what lets us answer "how did you get my email?" under GDPR Art 14 / CASL burden of proof.

## Approved answer: "How did you get my email?"
Use this wording (fill the brackets from the lead row), as a Gmail DRAFT for Aashmiin to send, and
flag it. Never add anything about the person's legal rights; if they raise one, ask her.

> Thanks for asking. I found [email] on [the page, e.g. your website's contact page] ([first_line_source URL])
> while looking for businesses that accept stablecoin payments. I've removed you from my list and won't
> email again.

Then add them to Do-not-contact the same day. [ASSUMPTION] This wording states the source and honours
the objection, which is what the GDPR Art 14 / PECR / CASL entries above require; a lawyer has not
reviewed it.
