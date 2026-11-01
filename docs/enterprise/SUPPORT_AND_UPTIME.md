# Support and uptime

Plain terms for pilots. Clearline is run by one founder; these commitments are sized to what one person can keep.

## Support during a pilot
- **Who:** the founder, Aashmiin Kaur, personally.
- **How:** email.
- **When:** a first reply **within 1 business day, Singapore time** (Mon–Fri, 09:00–18:00 SGT, excluding Singapore
  public holidays). Often faster, not promised.
- **What's included:** setup (about 30 minutes), help with exceptions, a weekly check-in, and the manual steps
  listed in `ENTERPRISE_ONE_PAGER.md` ("Delivered with our team").
- **No** phone line, **no** 24/7 cover, **no** second engineer. If the founder is away for more than 2 business days,
  you are told in advance.

## Uptime
- **No uptime SLA during pilots.** The service runs as one process on one host (`src/lib/lock.ts`); a restart
  interrupts it and loses running bulk jobs (`README.md`).
- Nothing about your money depends on Clearline being up: it never holds or moves funds. If it is down, payments
  still arrive in your wallet, and they can be recorded and matched when it's back. Nothing is posted to your books without approval.
- If you self-host, uptime is yours; we support you by email as above.

## Status and incident commitment
- **Status:** a short status line by email to your named contacts whenever the service is down for more than
  1 hour during Singapore business hours, and when it's restored. A public status page is **not yet** set up.
- **Security incident:** email within **72 hours** of becoming aware of a breach affecting your data (see
  `DATA_PROCESSING_TERMS_TEMPLATE.md` §8), with what happened, what data, what we've done, and next steps.
- **Wrong posting:** if Clearline posts something wrong to your books, we tell you the same business day we find
  it, list every affected entry from the audit log, and help reverse it by hand.
- **Post-incident note:** a written summary within 5 business days for any incident above.

## After the pilot
Paid plans keep the same email support. An uptime SLA, a status page and extended hours are **not yet** offered;
they come with the database move and a second operator.
