"""Earned autonomy. Works out which level the system has earned, and downgrades it automatically.

Level 1: every first email waits in the evening approval queue.
Level 2: after 50 first emails with <=1 factual error in a 10-email spot check, bounce <2%, no
         complaints: Tier 2/3 first emails send automatically; Tier 1 still waits.
Level 3: after 150 first emails, reply rate >=3% and the same quality bar: all send automatically,
         with a daily digest and a 10-email sample.
Downgrade to Level 1 immediately if: bounce >3%, any spam complaint, any factual error found, or
reply rate <1% over the last 50 sends.

The level is never raised by this script on its own: it reports what is EARNED, and the founder's
Settings value is the ceiling. Downgrades apply automatically.
"""
from __future__ import annotations

from dataclasses import dataclass

from .model import truthy


@dataclass
class Stats:
    first_sent: int
    bounced: int
    replied: int
    complaints: int
    factual_errors: int          # errors found in spot checks (all time)
    spot_checked: int
    last50_sent: int
    last50_replied: int

    @property
    def bounce_rate(self) -> float:
        return self.bounced / self.first_sent if self.first_sent else 0.0

    @property
    def reply_rate(self) -> float:
        return self.replied / self.first_sent if self.first_sent else 0.0


def stats_from(touches: list[dict], spot_checks: list[dict]) -> Stats:
    firsts = [t for t in touches if (t.get("step") or "").upper() == "D0" and (t.get("status") or "").lower() in {"sent", "replied", "bounced", "complaint", "unsubscribed"}]
    firsts.sort(key=lambda t: t.get("date", ""))
    emails = {(t.get("email") or "").lower() for t in firsts}
    status_by_email: dict[str, set[str]] = {}
    for t in touches:
        status_by_email.setdefault((t.get("email") or "").lower(), set()).add((t.get("status") or "").lower())
    replied = sum(1 for e in emails if "replied" in status_by_email.get(e, set()))
    bounced = sum(1 for e in emails if "bounced" in status_by_email.get(e, set()))
    complaints = sum(1 for e in emails if "complaint" in status_by_email.get(e, set()))
    last50 = [(t.get("email") or "").lower() for t in firsts[-50:]]
    return Stats(
        first_sent=len(emails), bounced=bounced, replied=replied, complaints=complaints,
        factual_errors=sum(1 for s in spot_checks if truthy(s.get("factual_error"))),
        spot_checked=len(spot_checks),
        last50_sent=len(last50),
        last50_replied=sum(1 for e in last50 if "replied" in status_by_email.get(e, set())),
    )


def downgrade_reasons(s: Stats) -> list[str]:
    r = []
    if s.first_sent >= 20 and s.bounce_rate > 0.03:
        r.append(f"bounce rate {s.bounce_rate:.1%} > 3%")
    if s.complaints:
        r.append(f"{s.complaints} spam complaint(s)")
    if s.factual_errors:
        r.append(f"{s.factual_errors} factual error(s) found in spot checks")
    if s.last50_sent >= 50 and s.last50_replied / s.last50_sent < 0.01:
        r.append("reply rate < 1% over the last 50 sends")
    return r


def earned_level(s: Stats) -> int:
    if downgrade_reasons(s):
        return 1
    quality = s.spot_checked >= 10 and s.factual_errors <= 1 and s.bounce_rate < 0.02 and s.complaints == 0
    if s.first_sent >= 150 and quality and s.reply_rate >= 0.03:
        return 3
    if s.first_sent >= 50 and quality:
        return 2
    return 1


def effective_level(settings_level: int, s: Stats) -> tuple[int, list[str]]:
    """The level the system may use today: never above Settings, never above what's earned."""
    reasons = downgrade_reasons(s)
    return min(max(1, settings_level), earned_level(s)), reasons
