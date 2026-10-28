"""Daily volume: ramp, auto-throttle, 30-day bulk line and inbox rotation.

"Emails per day" = first emails + follow-ups combined (the founder's definition).

Personal-Gmail mode: cap = min(DAILY_CAP, CURRENT_SEND_CAP). No ramp, no rotation.
Domain mode (separate domain, 2-3 inboxes, warm-up always on):
  - nothing goes out until DOMAIN_READY (SPF/DKIM/DMARC) and UNSUBSCRIBE_READY (one-click link)
  - week 1 from RAMP_START = warm-up only (cap 0; hand-sent emails are outside the system)
  - week 2 = 20/day, week 3 = 35/day, week 4+ = 50/day (RAMP_CAPS)
  - a step UP happens only if bounce < 2%, no spam complaint and PLACEMENT_OK; otherwise the cap
    stays at the previous week's step
  - never above PER_INBOX_CAP x number of inboxes, never above DAILY_CAP
  - auto-throttle to THROTTLE_CAP (20) if bounce > 3%, any complaint, or reply rate < 1% over the
    last 100 sends; this is reported as an alert
30-day line: warn at 90% of SIMILAR_30D_CAP; at the cap, block unless BULK_CONFIRMED.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

from .model import Settings, parse_date

SENT = {"sent"}
FIRST_STATES = {"sent", "replied", "bounced", "complaint", "unsubscribed"}


@dataclass
class Volume:
    cap: int
    sent_today: int
    sent_30d: int
    ramp_week: int = 0
    reasons: list[str] = field(default_factory=list)   # why the cap is what it is
    alerts: list[str] = field(default_factory=list)    # things the founder must hear today
    throttled: bool = False

    @property
    def remaining(self) -> int:
        return max(0, self.cap - self.sent_today)


def _sent_emails(touches: list[dict]) -> list[dict]:
    return [t for t in touches if (t.get("status") or "").lower() in SENT and (t.get("channel") or "email").lower() == "email"]


def _health(touches: list[dict]) -> dict:
    """Bounce, complaints, and reply rate over the last 100 first emails."""
    firsts = sorted((t for t in touches if (t.get("step") or "").upper() == "D0" and (t.get("status") or "").lower() in FIRST_STATES),
                    key=lambda t: t.get("date", ""))
    by_email: dict[str, set[str]] = {}
    for t in touches:
        by_email.setdefault((t.get("email") or "").lower(), set()).add((t.get("status") or "").lower())
    emails = [(t.get("email") or "").lower() for t in firsts]
    n = len(set(emails))
    bounced = sum(1 for e in set(emails) if "bounced" in by_email.get(e, ()))
    complaints = sum(1 for e in set(emails) if "complaint" in by_email.get(e, ()))
    last100 = emails[-100:]
    replied100 = sum(1 for e in last100 if "replied" in by_email.get(e, ()))
    return {"n": n, "bounce": bounced / n if n else 0.0, "complaints": complaints,
            "last100": len(last100), "reply100": replied100 / len(last100) if last100 else 0.0}


def daily_cap(s: Settings, touches: list[dict], today: date) -> Volume:
    sent = _sent_emails(touches)
    sent_today = sum(1 for t in sent if parse_date(t.get("date")) == today)
    sent_30d = sum(1 for t in sent if (d := parse_date(t.get("date"))) and timedelta(0) <= today - d < timedelta(days=30))
    v = Volume(cap=0, sent_today=sent_today, sent_30d=sent_30d)
    h = _health(touches)

    if s.send_mode != "domain":
        v.cap = s.effective_daily_cap
        v.reasons.append(f"personal Gmail mode: cap {v.cap}/day")
    else:
        if not s.domain_ready:
            v.reasons.append("domain mode: SPF/DKIM/DMARC not confirmed (DOMAIN_READY=FALSE)")
        if not s.unsubscribe_ready:
            v.reasons.append("domain mode: one-click unsubscribe link not confirmed (UNSUBSCRIBE_READY=FALSE)")
        if not s.inboxes:
            v.reasons.append("domain mode: no INBOXES listed")
        start = parse_date(s.ramp_start)
        if not start:
            v.reasons.append("domain mode: RAMP_START not set")
        if v.reasons:
            v.cap = 0
        else:
            week = (today - start).days // 7 if today >= start else -1
            v.ramp_week = week + 1
            if week < 0:
                v.cap = 0
                v.reasons.append("ramp has not started")
            else:
                idx = min(week, len(s.ramp_caps) - 1)
                healthy = h["bounce"] < 0.02 and h["complaints"] == 0 and s.placement_ok
                if idx > 0 and not healthy:
                    idx_held = max(0, idx - 1)
                    v.reasons.append(
                        f"ramp step held at week {idx_held + 1} level: needs bounce <2% (now {h['bounce']:.1%}), "
                        f"no complaints (now {h['complaints']}) and PLACEMENT_OK=TRUE (now {s.placement_ok})")
                    idx = idx_held
                v.cap = s.ramp_caps[idx]
                v.reasons.append(f"ramp week {week + 1}: {v.cap}/day")
                inbox_cap = s.per_inbox_cap * len(s.inboxes)
                if v.cap > inbox_cap:
                    v.cap = inbox_cap
                    v.reasons.append(f"limited by {len(s.inboxes)} inboxes x {s.per_inbox_cap}")
        v.cap = min(v.cap, s.daily_cap)

    # Auto-throttle (both modes)
    why = []
    if h["n"] >= 20 and h["bounce"] > 0.03:
        why.append(f"bounce {h['bounce']:.1%} > 3%")
    if h["complaints"]:
        why.append(f"{h['complaints']} spam complaint(s)")
    if h["last100"] >= 100 and h["reply100"] < 0.01:
        why.append(f"reply rate {h['reply100']:.1%} < 1% over the last 100 sends")
    if why and v.cap > s.throttle_cap:
        v.cap = s.throttle_cap
        v.throttled = True
        v.alerts.append("AUTO-THROTTLE to %d/day: %s" % (s.throttle_cap, "; ".join(why)))
    elif why:
        v.alerts.append("Warning: " + "; ".join(why))

    # 30-day bulk line (Singapore Spam Control Act: >1,000 similar messages in 30 days = bulk)
    if s.similar_30d_cap and v.sent_30d >= 0.9 * s.similar_30d_cap and not s.bulk_confirmed:
        v.alerts.append(f"30-day total is {v.sent_30d} of {s.similar_30d_cap}: confirm Spam Control Act bulk "
                        "duties with a professional and set BULK_CONFIRMED=TRUE, or sending stops at the line")
    return v


def assign_inboxes(s: Settings, touches: list[dict], n: int, today: date, planned: dict | None = None) -> list[str]:
    """Round-robin the next n sends across inboxes, never above PER_INBOX_CAP per inbox today."""
    if s.send_mode != "domain" or not s.inboxes:
        return [""] * n
    used = {i: 0 for i in s.inboxes}
    for t in touches:
        if (t.get("status") or "").lower() in SENT and parse_date(t.get("date")) == today:
            i = (t.get("inbox") or "").lower()
            if i in used:
                used[i] += 1
    for i, k in (planned or {}).items():
        if i in used:
            used[i] += k
    out = []
    for _ in range(n):
        free = [i for i in s.inboxes if used[i] < s.per_inbox_cap]
        if not free:
            out.append("")
            continue
        pick = min(free, key=lambda i: used[i])
        used[pick] += 1
        out.append(pick)
    return out
