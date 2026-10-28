"""The safety guard. Every scheduled task runs this before it drafts or sends anything.

A candidate is one planned email: {lead_id, email, step, first_line_source, ...}. The guard answers
ALLOW or BLOCK with reasons, and whether a human must approve it at the current autonomy level.
It never sends anything itself.

Rules (from the founder's brief):
- PAUSE in Settings stops everything.
- Cold first emails: at most min(DAILY_CAP, CURRENT_SEND_CAP) per day; at most SIMILAR_30D_CAP in
  any 30 days. Stop at the cap.
- Never email anyone (or any domain) on Do-not-contact.
- Never two people at the same company within SAME_COMPANY_DAYS days.
- A first email needs a source URL for its first line, a sendable email label, channel "email",
  and is blocked for strict-consent countries and support inboxes. US needs a postal address.
- Follow-ups (D4, D11) only in an existing thread, only if the first email was sent, enough days
  have passed, and the person hasn't replied, bounced or unsubscribed.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

from .model import (
    SENDABLE_LABELS, STRICT_COUNTRIES, SUPPORT_LOCALS, Settings, domain_of, email_local, parse_date,
)

FOLLOWUP_GAP = {"D4": 4, "D11": 11}
STOP_STATUSES = {"replied", "bounced", "unsubscribed", "complaint", "opted-out", "do-not-contact"}
SENT_STATUSES = {"sent"}


@dataclass
class Verdict:
    lead_id: str
    email: str
    step: str
    allow: bool = True
    needs_approval: bool = True
    reasons: list[str] = field(default_factory=list)

    def block(self, why: str) -> None:
        self.allow = False
        self.reasons.append(why)

    @property
    def label(self) -> str:
        return "ALLOW" if self.allow else "BLOCK"


def _dnc_sets(dnc: list[dict]) -> tuple[set[str], set[str]]:
    emails, domains = set(), set()
    for r in dnc:
        v = (r.get("value") or "").strip().lower()
        if not v:
            continue
        if "@" in v:
            emails.add(v)
        else:
            domains.add(domain_of(v))
    return emails, domains


def _first_sends(touches: list[dict]) -> list[dict]:
    return [t for t in touches if (t.get("step") or "").upper() == "D0" and (t.get("status") or "").lower() in SENT_STATUSES]


def needs_human(settings: Settings, tier: str, step: str) -> bool:
    """Earned autonomy: which emails still need the founder's click."""
    step = step.upper()
    if step in FOLLOWUP_GAP:
        return False  # follow-ups in an approved thread are automatic
    level = settings.autonomy_level
    if level >= 3:
        return False
    if level == 2:
        return str(tier).strip().upper() in {"1", "T1", "TIER 1"}
    return True


def check(candidates: list[dict], leads: list[dict], touches: list[dict], dnc: list[dict],
          settings: Settings, today: date | None = None) -> list[Verdict]:
    today = today or date.today()
    lead_by_id = {l.get("id"): l for l in leads}
    dnc_emails, dnc_domains = _dnc_sets(dnc)

    first = _first_sends(touches)
    sent_today = sum(1 for t in first if parse_date(t.get("date")) == today)
    sent_30d = sum(1 for t in first if (d := parse_date(t.get("date"))) and today - d < timedelta(days=30))

    # company -> last date any first email or follow-up went to it
    recent_domain: dict[str, date] = {}
    for t in touches:
        if (t.get("status") or "").lower() not in SENT_STATUSES:
            continue
        d = parse_date(t.get("date"))
        dom = (t.get("domain") or domain_of(t.get("email", ""))).lower()
        if d and dom:
            recent_domain[dom] = max(recent_domain.get(dom, d), d)

    out: list[Verdict] = []
    planned_first = 0
    planned_domains: set[str] = set()
    for c in candidates:
        lead = lead_by_id.get(c.get("lead_id"), {})
        email = (c.get("email") or lead.get("email") or "").strip().lower()
        step = (c.get("step") or "D0").upper()
        v = Verdict(c.get("lead_id", ""), email, step)
        v.needs_approval = needs_human(settings, lead.get("tier", ""), step)

        if settings.pause:
            v.block("PAUSE is on")
        if not email or "@" not in email:
            v.block("no email address")
        dom = (lead.get("domain") or domain_of(email)).lower()
        if email in dnc_emails or dom in dnc_domains:
            v.block("on Do-not-contact")
        if (lead.get("stage") or "").lower() == "do not contact":
            v.block("lead stage is Do not contact")

        thread = [t for t in touches if (t.get("email") or "").strip().lower() == email]
        if any((t.get("status") or "").lower() in STOP_STATUSES for t in thread):
            v.block("person replied, bounced or unsubscribed: stop the sequence")

        if step == "D0":
            if any((t.get("step") or "").upper() == "D0" and (t.get("status") or "").lower() in SENT_STATUSES for t in thread):
                v.block("first email already sent to this person")
            src = (c.get("first_line_source") or lead.get("first_line_source") or "").strip()
            if not src.startswith("http"):
                v.block("first line has no source URL")
            if (lead.get("email_label") or "").upper() not in SENDABLE_LABELS:
                v.block(f"email not verified ({lead.get('email_label') or 'no label'})")
            if (lead.get("channel") or "").lower() not in {"email", ""}:
                v.block(f"channel is '{lead.get('channel')}', not email")
            country = (lead.get("country") or "").strip().lower()
            if country in STRICT_COUNTRIES:
                v.block(f"{lead.get('country')}: strict consent rules, LinkedIn or intro first")
            if country.startswith("united states") and not settings.postal_address:
                v.block("US contact: add POSTAL_ADDRESS in Settings first (CAN-SPAM)")
            if email_local(email) in SUPPORT_LOCALS:
                v.block("support inbox: low reply odds, use LinkedIn")
            last = recent_domain.get(dom)
            if dom and last and (today - last).days < settings.same_company_days:
                v.block(f"someone at {dom} was emailed on {last}: wait {settings.same_company_days} days")
            if dom in planned_domains:
                v.block(f"another person at {dom} is already in today's batch")
            if v.allow:
                if sent_today + planned_first >= settings.effective_daily_cap:
                    v.block(f"daily cap reached ({settings.effective_daily_cap})")
                elif sent_30d + planned_first >= settings.similar_30d_cap:
                    v.block(f"30-day cap reached ({settings.similar_30d_cap})")
            if v.allow:
                planned_first += 1
                planned_domains.add(dom)
        elif step in FOLLOWUP_GAP:
            d0 = [t for t in thread if (t.get("step") or "").upper() == "D0" and (t.get("status") or "").lower() in SENT_STATUSES]
            if not d0:
                v.block("no first email sent in this thread")
            else:
                if not any(truthy_approved(t) for t in d0):
                    v.block("first email was not approved")
                d = parse_date(d0[0].get("date"))
                if d and (today - d).days < FOLLOWUP_GAP[step]:
                    v.block(f"too early: {step} is due {d + timedelta(days=FOLLOWUP_GAP[step])}")
                if not any((t.get("thread_id") or "").strip() for t in d0):
                    v.block("no thread id: follow-up must reply in the same thread")
            if any((t.get("step") or "").upper() == step and (t.get("status") or "").lower() in SENT_STATUSES for t in thread):
                v.block(f"{step} already sent")
        else:
            v.block(f"unknown step {step}")
        out.append(v)
    return out


def truthy_approved(t: dict) -> bool:
    return str(t.get("approved", "")).strip().lower() in {"true", "yes", "1", "y", "auto", "approved"}
