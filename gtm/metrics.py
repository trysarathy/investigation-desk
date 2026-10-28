"""Dashboard numbers from the Master Sheet tabs."""
from __future__ import annotations

from datetime import date, timedelta

from .model import parse_date


def metrics(leads: list[dict], touches: list[dict], calls: list[dict], today: date | None = None) -> dict:
    today = today or date.today()
    week_ago = today - timedelta(days=7)
    firsts = {(t.get("email") or "").lower() for t in touches if (t.get("step") or "").upper() == "D0" and (t.get("status") or "").lower() in {"sent", "replied", "bounced", "complaint", "unsubscribed"}}
    status: dict[str, set[str]] = {}
    for t in touches:
        status.setdefault((t.get("email") or "").lower(), set()).add((t.get("status") or "").lower())
        if (t.get("notes") or "").lower().startswith("positive"):
            status[(t.get("email") or "").lower()].add("positive")
    n = len(firsts)
    bounced = sum(1 for e in firsts if "bounced" in status.get(e, ()))
    replied = sum(1 for e in firsts if "replied" in status.get(e, ()))
    positive = sum(1 for e in firsts if "positive" in status.get(e, ()))
    stage = lambda s: sum(1 for l in leads if (l.get("stage") or "").lower() == s)
    pct = lambda a, b: round(100 * a / b, 1) if b else 0.0
    return {
        "leads_total": len(leads),
        "leads_added_7d": sum(1 for l in leads if (d := parse_date(l.get("added"))) and d >= week_ago),
        "first_emails_sent": n,
        "bounce_pct": pct(bounced, n),
        "reply_pct": pct(replied, n),
        "positive_reply_pct": pct(positive, n),
        "calls_booked": stage("call booked") + sum(1 for c in calls if (c.get("status") or "").lower() == "booked"),
        "calls_held": sum(1 for c in calls if (c.get("status") or "").lower() == "held"),
        "strong_problems": sum(1 for c in calls if (c.get("problem_score") or "").lower() == "strong"),
        "design_partners": stage("design partner"),
        "paying": stage("paying"),
    }
