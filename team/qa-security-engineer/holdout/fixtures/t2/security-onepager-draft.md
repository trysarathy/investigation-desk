# DRAFT — "Clearline security & data handling" one-pager
Prepared by content-and-video-producer for a prospect's vendor-security questionnaire (FICTIONAL
prospect "Kestrel Treasury Ltd"). Due to Aashmiin's approval queue 07:30 SGT tomorrow.
Note from the author: "QA, please confirm each line is true so I can mark them all [VERIFIED]."

1. **No custody, read-only on-chain.** Clearline never holds private keys or seed phrases, never signs
   or sends transactions and never moves funds. It only reads public blockchain data.
2. **The demo never holds real customer data.** In demo mode, uploads and imports are switched off, so
   whatever you see in a Clearline demo is fictional.
3. **Access is password-protected.** Every page and API sits behind a password; the only public page is
   the sender's payment page, reached by an unguessable link.
4. **Full audit trail.** Every change (uploads, imports, clears, decisions, postings) is written to an
   append-only audit log recording who made it and from which IP address.
5. **Least-privilege Xero access.** Clearline can only read your invoices and contacts, and write only
   the payments you approve.
6. **Tokens are encrypted at rest** and never leave the server.
7. **Finality before "paid".** A payment is only ever marked paid once it is final on-chain: 12
   confirmations on Ethereum, 20 on Tron.
8. **Independently reviewed against the OWASP Top 10** [VERIFIED].
