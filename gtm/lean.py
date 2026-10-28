"""Lean mode: Clearline sends from Aashmiin's personal Gmail until her domain and inboxes are ready.

- Up to FIRST_EMAIL_CAP (10) new first emails per weekday, inside a total of CURRENT_SEND_CAP (20)
  Gmail sends per day that also covers follow-ups and automatic replies.
- Week 1 (the first 7 days from LEAN_START): tomorrow's first emails are queued at the evening run and
  go out automatically from 9:00 their time unless Aashmiin replied HOLD (that date is in HOLD_DATES).
- From week 2: first emails go without the queue, but only if WEEK1_SPOTCHECK_PASSED is TRUE and
  bounce < 2% with no complaints. Otherwise the week-1 queue-with-HOLD process continues.
- Every send happens between 9:00 and 17:00 in the recipient's time zone, on their weekday.
- When SEND_MODE = domain and DOMAIN_READY = TRUE, cold sending from personal Gmail stops entirely
  (first emails and follow-ups); only replies to people who wrote in still go from Gmail.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

from .model import Settings, parse_date

# Standard offsets from UTC (hours). Daylight saving is ignored on purpose: the 9-17 window has slack.
TZ_OFFSET = {
    "singapore": 8, "india": 5.5, "hong kong": 8, "united arab emirates": 4, "uae": 4, "israel": 2,
    "united kingdom": 0, "ireland": 0, "france": 1, "belgium": 1, "switzerland": 1, "lithuania": 2,
    "estonia": 2, "latvia": 2, "cyprus": 2, "malta": 1, "gibraltar": 1, "portugal": 0, "poland": 1,
    "norway": 1, "sweden": 1, "denmark": 1, "finland": 2, "czechia": 1, "türkiye": 3, "turkey": 3,
    "bahrain": 3, "saudi arabia": 3, "qatar": 3, "nigeria": 1, "kenya": 3, "ghana": 0, "egypt": 2,
    "australia": 10, "new zealand": 12, "japan": 9, "taiwan": 8, "philippines": 8, "indonesia": 7,
    "thailand": 7, "malaysia": 8, "argentina": -3, "brazil": -3, "mexico": -6, "chile": -4, "peru": -5,
    "georgia": 4, "pakistan": 5, "bangladesh": 6, "sri lanka": 5.5, "nepal": 5.75,
}
SEND_START, SEND_END = time(9, 0), time(17, 0)


def offset_for(country: str) -> float | None:
    c = (country or "").strip().lower()
    for k, v in TZ_OFFSET.items():
        if c == k or c.startswith(k):
            return v
    return None


def in_send_window(country: str, now_utc: datetime) -> bool:
    """True if it's a weekday between 9:00 and 17:00 for the recipient. Unknown country -> Singapore time."""
    off = offset_for(country)
    local = now_utc.astimezone(timezone(timedelta(hours=off if off is not None else 8)))
    return local.weekday() < 5 and SEND_START <= local.time() < SEND_END


def lean_week(s: Settings, day: date) -> int:
    start = parse_date(s.lean_start)
    if not start or day < start:
        return 0
    return (day - start).days // 7 + 1


def first_email_policy(s: Settings, day: date, bounce: float, complaints: int) -> str:
    """'queue_with_hold' (queued the evening before, auto-sent unless HOLD) or 'direct'."""
    if lean_week(s, day) >= 2 and s.week1_spotcheck_passed and bounce < 0.02 and complaints == 0:
        return "direct"
    return "queue_with_hold"


def gmail_cold_allowed(s: Settings) -> bool:
    """Cold email (first emails and follow-ups) from personal Gmail stops once the domain is live."""
    return not (s.send_mode == "domain" and s.domain_ready)


# The accounting question (added 28 Oct 2026 with the "in your books" positioning). Asked in the D4
# follow-up and on every call, word for word, so answers can be compared across calls.
ACCOUNTING_QUESTION = ("After a stablecoin payment is matched, how does it get into your accounting system today, "
                       "and how long does that take?")

SIGNATURE = (
    "Best regards,\n"
    "Aashmiin Kaur\n"
    "SMU student, Singapore · {linkedin}\n\n"
    "If you'd rather not hear from me, just reply \"no\" and I won't email again."
)


def first_email(greeting: str, first_line: str, question: str, close: str, linkedin: str) -> str:
    """The D0 template: plain text, one sourced first line, an opt-out, no link except LinkedIn."""
    return (f"{greeting}\n\n{first_line}\n\n"
            "I'm Aashmiin, a student at SMU in Singapore, researching what happens when stablecoin payments "
            "arrive wrong: short after fees, on the wrong network, a fake token, or with no invoice reference.\n\n"
            f"{question}\n\n"
            f"I'm not selling anything. 15 minutes of your experience would help me a lot. {close}\n\n"
            + SIGNATURE.format(linkedin=linkedin))


OPT_OUT = "If you'd rather not hear from me, just reply \"no\" and I won't email again."


def followup(step: str, greeting: str, linkedin: str) -> str:
    """D4: one short nudge with one question (the accounting question). D11: a polite close. Both carry the opt-out."""
    if step == "D4":
        body = ("Just bringing this back to the top of your inbox. Even a two-line reply would help: "
                f"{ACCOUNTING_QUESTION[0].lower()}{ACCOUNTING_QUESTION[1:]}")
    else:
        body = ("I'll leave it here after this one. If someone else on your team handles incoming payments, "
                "I'd be grateful for their name. Thank you either way.")
    return f"{greeting}\n\n{body}\n\nAashmiin\n{linkedin}\n\n{OPT_OUT}"
